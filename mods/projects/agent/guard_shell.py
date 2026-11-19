"""Shell parsing for the run guard: which commands a Bash call actually runs.

Rules look at the words of each simple command (after env assignments and wrappers like
nohup), inside `bash -c` strings and commands sent over ssh, so a word that only appears in
quoted text, a commit message or a heredoc body never counts as something being run.
"""
import os
import re
import shlex

SEPARATORS = {";", "&&", "||", "|", "&", "(", ")", ";;", "|&"}
WRAPPERS = {"env", "time", "nohup", "exec", "command", "builtin", "nice", "timeout", "xargs", "setsid"}
SHELLS = {"bash", "sh", "zsh", "dash"}
SSH_OPTIONS_WITH_VALUE = set("bcDEeFIiJLlmOopQRSWw")
HEREDOC = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")


def strip_heredocs(command):
    """Drops heredoc bodies; they are data fed to a command, not commands."""
    lines, kept, ending = command.split("\n"), [], None
    for line in lines:
        if ending is not None:
            if line.strip() == ending:
                ending = None
            continue
        kept.append(line)
        match = HEREDOC.search(line)
        if match:
            ending = match.group(2)
    return "\n".join(kept)


def shell_tokens(command):
    lexer = shlex.shlex(command.replace("\n", " ;\n"), posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    try:
        return list(lexer)
    except ValueError:
        return []


def parse_shell(command):
    """Each simple command's words, and the files its > and >> redirections write."""
    segments, current, redirects = [], [], []
    tokens = shell_tokens(strip_heredocs(command))
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token in SEPARATORS:
            segments.append(current)
            current = []
        elif token.endswith(">") and set(token) <= set("&>|"):
            if index + 1 < len(tokens):
                redirects.append(tokens[index + 1])
            index += 1
        elif token.startswith("<"):
            index += 1
        elif not (token.isdigit() and index + 1 < len(tokens) and tokens[index + 1].endswith(">")):
            current.append(token)
        index += 1
    return [s for s in [*segments, current] if s], redirects


def unwrap(words):
    """The command a segment really runs, without assignments and wrappers in front."""
    while words:
        head = os.path.basename(words[0])
        if "=" in words[0] and not words[0].startswith("-"):
            words = words[1:]
        elif head in WRAPPERS:
            words = [w for w in words[1:]]
            while words and words[0].startswith("-"):
                words = words[1:]
        else:
            return words
    return words


def ssh_remote(words):
    """The remote command of an ssh call, or None when it only opens a session."""
    index = 1
    while index < len(words) and words[index].startswith("-"):
        flag = words[index]
        index += 2 if len(flag) == 2 and flag[1] in SSH_OPTIONS_WITH_VALUE else 1
    rest = words[index + 1:]
    return " ".join(rest) if rest else None


def commands(command, depth=0):
    """Every simple command the call runs, including nested bash -c and ssh commands."""
    found = []
    segments, _ = parse_shell(command)
    for segment in segments:
        words = unwrap(segment)
        if not words:
            continue
        found.append(words)
        name = os.path.basename(words[0])
        if depth > 3:
            continue
        if name in SHELLS and "-c" in words[1:-1]:
            found.extend(commands(words[words.index("-c") + 1], depth + 1))
        elif name == "ssh":
            remote = ssh_remote(words)
            if remote:
                found.extend(commands(remote, depth + 1))
    return found


def subcommand(words, skip_with_value=("-C", "-c")):
    """First non-option argument, skipping options that take a value (git -C dir, -c k=v)."""
    index = 1
    while index < len(words):
        word = words[index]
        if word in skip_with_value:
            index += 2
        elif word.startswith("-"):
            index += 1
        else:
            return word, words[index + 1:]
    return None, []
