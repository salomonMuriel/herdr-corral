#!/usr/bin/env python3
"""PreToolUse hook for agents a Herdr run starts unattended.

It answers every permission question itself: safe calls are allowed so the agent never
waits on a prompt, and the few dangerous ones are refused with a reason so the agent
takes another route. Questions to the person are refused too: the agent decides and
notes it. In plan mode the plan's approval and the edits are left to Claude Code. On any error it stays silent, so Claude Code's normal checks apply.

Rules look only at what a command runs (guard_shell.commands), so mentioning a deploy in
a note, a commit message or a file the agent edits is never refused.

With --coordinator it guards a project's coordinator, which never writes code: on top of
the same rules it refuses edits outside temp folders, git commands that change a repo,
installs and writes to the board's tables, and sends questions to hb ask.
"""
import json
import os
import re
import sys

from guard_shell import commands, parse_shell, subcommand

HOME = os.path.expanduser("~")
PROTECTED = [os.path.join(HOME, p) for p in (".config/herdr-app", ".config/herdr-board", ".config/gh", ".claude", ".ssh")]
TEMP_ROOTS = ["/tmp", "/private/tmp", "/var/folders", os.environ.get("TMPDIR", "/tmp")]

DECIDE = ("This is an unattended run and nobody can answer. Make the reasonable call yourself, "
          "record it with hb note, and list your assumptions in the hb done summary. Use hb ask "
          "only if you truly can't continue (a missing credential or access), then keep going on "
          "whatever else you can.")
DEPLOY = ("Running a deploy waits for the person's review; editing or testing deploy code is fine. "
          "Merge to main and finish with hb done.")
COORDINATOR_ASK = ("Pass questions on with hb ask \"<question>\" and stop; the person's answer comes back "
                   "to you as a message.")
# A run started in plan mode leaves these to Claude Code: the person approves the plan, and
# until then its plan-mode rules allow writing only the plan file.
PLAN_MODE_OWN = {"ExitPlanMode", "Edit", "Write", "MultiEdit", "NotebookEdit"}
NO_CODE = "The coordinator never changes code. Add a task with hb add and start an agent on it with hb start."

DEPLOY_TOOLS = {"vercel": {"deploy", "--prod"}, "netlify": {"deploy"}, "flyctl": {"deploy"}, "fly": {"deploy"}, "railway": {"up"}}
DOCKER_SERVICE = {"up", "down", "rm", "restart", "stop", "kill"}
DESTRUCTIVE_SQL = re.compile(r"\b(drop\s+(table|database|schema)|truncate\s+table)\b", re.IGNORECASE)
SQL_WRITE = re.compile(r"\b(insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|create\s+table)\b", re.IGNORECASE)
SQL_TOOLS = {"psql", "neonctl", "sqlite3"}
FILE_COMMANDS = {"rm", "mv", "cp", "tee", "touch", "mkdir", "ln", "chmod", "truncate", "install", "rsync", "sed", "perl"}
TARGET_IS_LAST = {"mv", "cp", "ln", "install", "rsync"}
HARMLESS_TARGETS = {"/dev/null", "/dev/stderr", "/dev/stdout"}
COORDINATOR_GIT = {"commit", "push", "merge", "rebase", "reset", "checkout", "switch", "stash", "cherry-pick", "revert",
                   "am", "apply", "tag", "worktree", "restore", "rm", "mv", "add", "pull"}
INSTALLS = {"pnpm": {"i", "install", "add", "remove", "update"}, "npm": {"i", "install", "add", "remove", "update"},
            "yarn": {"install", "add", "remove"}, "bun": {"i", "install", "add", "remove"}, "pip": {"install"},
            "pip3": {"install"}, "uv": {"add", "sync", "pip", "lock"}}


def inside(path, root):
    path, root = os.path.realpath(path), os.path.realpath(root)
    return path == root or path.startswith(root + os.sep)


def in_temp(path):
    return any(inside(path, t) for t in TEMP_ROOTS if t)


def allowed_place(path, cwd):
    return inside(path, cwd) or in_temp(path)


def resolve(token, cwd):
    return os.path.normpath(os.path.join(cwd, os.path.expanduser(token)))


def main_checkout(cwd):
    marker = os.sep + os.path.join(".claude", "worktrees") + os.sep
    return cwd.split(marker)[0] if marker in cwd + os.sep else None


def runs_drizzle_change(words):
    tool = next((i for i, w in enumerate(words) if os.path.basename(w) == "drizzle-kit"), None)
    return tool is not None and any(w in ("push", "migrate") for w in words[tool + 1:tool + 2])


def check_git(words, cwd):
    sub, rest = subcommand(words)
    if sub == "push" and any(w in ("--force", "-f", "--force-with-lease") or w.startswith("--force") or w.startswith("+") for w in rest):
        return "Force-pushing can destroy other work. Rebase and push normally."
    if sub == "branch" and "-D" in rest:
        return "Deleting unmerged branches is the person's call."
    checkout = main_checkout(cwd)
    target = words[words.index("-C") + 1] if "-C" in words[:-1] else None
    if checkout and target and inside(resolve(target, cwd), checkout) and not inside(resolve(target, cwd), cwd) \
            and sub in ("checkout", "switch", "reset", "clean", "stash", "rebase"):
        return "The main checkout belongs to the person; work only in your worktree."
    if not checkout and ((sub == "reset" and "--hard" in rest) or (sub == "clean" and any(w.startswith("-") and "f" in w for w in rest))):
        return "Hard resets and cleans only inside your own task worktree."
    return None


def check_command(words, cwd):
    name = os.path.basename(words[0])
    sub, rest = subcommand(words)
    if name in ("deploy", "deploy-pi") or words[0].endswith("scripts/deploy"):
        return DEPLOY
    if name in DEPLOY_TOOLS and any(w in DEPLOY_TOOLS[name] for w in words[1:]):
        return "Production deploys wait for the person's review."
    if (name == "docker" and sub == "compose" and any(w in DOCKER_SERVICE for w in rest)) or \
            (name == "docker" and sub in ("rm", "stop", "kill", "restart")) or \
            (name == "docker-compose" and sub in DOCKER_SERVICE):
        return "Starting or stopping services is a deploy and waits for the person."
    if name == "git":
        return check_git(words, cwd)
    if name == "neonctl" and any(w in ("delete", "rm") for w in words[1:]):
        return "Deleting Neon resources is the person's call."
    if runs_drizzle_change(words):
        return "Schema changes against a shared database wait for the person; use a Neon branch and note it."
    if name in SQL_TOOLS and DESTRUCTIVE_SQL.search(" ".join(words[1:])):
        return "Destructive SQL waits for the person."
    if name == "sudo":
        return "No sudo in unattended runs."
    if (name == "hc" and sub in ("kill", "interrupt")) or \
            (name == "herdr-app" and sub == "do" and rest[:1] and rest[0] in ("tab.close", "space.close", "terminal.kill")):
        return "Other sessions belong to other tasks; don't stop them."
    return check_rm(words, cwd)


def check_rm(words, cwd):
    if os.path.basename(words[0]) != "rm" or not any(a.startswith("-") and "r" in a.lower() for a in words[1:]):
        return None
    for target in (a for a in words[1:] if not a.startswith("-")):
        if not allowed_place(resolve(target, cwd), cwd):
            return f"Recursive delete outside your worktree ({target}) isn't allowed unattended."
    return None


def file_targets(words):
    name = os.path.basename(words[0])
    if name not in FILE_COMMANDS:
        return []
    if name in ("sed", "perl") and not any(a.startswith("-i") for a in words[1:]):
        return []
    args = [a for a in words[1:] if not a.startswith("-")]
    if name in ("sed", "perl"):
        return args[-1:]
    return args[-1:] if name in TARGET_IS_LAST else args


def written_files(command, runs):
    _, redirects = parse_shell(command)
    targets = [t for t in redirects if t not in HARMLESS_TARGETS]
    for words in runs:
        targets.extend(file_targets(words))
    return targets


def pipes_download_to_shell(command):
    return re.search(r"(^|[;&|(]\s*)(curl|wget)\b[^;&|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b", command) is not None


def check_bash(command, cwd):
    runs = commands(command)
    for words in runs:
        reason = check_command(words, cwd)
        if reason:
            return reason
    if pipes_download_to_shell(command):
        return "Piping downloads into a shell isn't allowed unattended."
    for target in written_files(command, runs):
        full = resolve(target, cwd)
        if any(inside(full, root) for root in PROTECTED):
            return f"{target} is shared by every session; don't change it from a task."
    return None


def check_coordinator_command(words):
    name = os.path.basename(words[0])
    sub, rest = subcommand(words)
    if name == "git" and sub in COORDINATOR_GIT:
        return NO_CODE
    if name in INSTALLS and sub in INSTALLS[name]:
        return NO_CODE
    if (name in SQL_TOOLS or name in ("curl", "python3", "python", "node")) and SQL_WRITE.search(" ".join(words[1:])):
        return "Change the board with hb (add, start, note), not SQL."
    if name == "gh" and ((sub == "pr" and rest[:1] and rest[0] in ("merge", "close", "review", "create")) or
                         (sub == "issue" and rest[:1] and rest[0] in ("close", "delete", "edit"))):
        return "Merging, closing and reviewing are the person's calls."
    return None


def check_coordinator_bash(command, cwd):
    runs = commands(command)
    for words in runs:
        reason = check_coordinator_command(words)
        if reason:
            return reason
    for target in written_files(command, runs):
        if not in_temp(resolve(target, cwd)):
            return f"{NO_CODE} Scratch files go in /tmp ({target} is outside it)."
    return None


def check_write(path, cwd):
    if not path or allowed_place(resolve(path, cwd), cwd):
        return None
    return f"Write only inside your task worktree ({cwd}); {path} is outside it."


def decide_coordinator(tool, data, cwd):
    if tool == "AskUserQuestion":
        return "deny", COORDINATOR_ASK
    if tool == "Bash":
        command = data.get("command", "")
        reason = check_bash(command, cwd) or check_coordinator_bash(command, cwd)
    elif tool in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        path = data.get("file_path") or data.get("notebook_path")
        reason = None if path and in_temp(resolve(path, cwd)) else NO_CODE
    else:
        reason = None
    return ("deny", reason) if reason else ("allow", "Coordinator: allowed by the run guard.")


def decide(event, coordinator=False):
    tool = event.get("tool_name", "")
    data = event.get("tool_input", {}) or {}
    cwd = event.get("cwd") or os.getcwd()
    if coordinator:
        return decide_coordinator(tool, data, cwd)
    if event.get("permission_mode") == "plan" and tool in PLAN_MODE_OWN:
        return None
    if tool == "AskUserQuestion":
        return "deny", DECIDE
    if tool == "Bash":
        reason = check_bash(data.get("command", ""), cwd)
    elif tool in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        reason = check_write(data.get("file_path") or data.get("notebook_path"), cwd)
    else:
        reason = None
    return ("deny", reason) if reason else ("allow", "Unattended run: allowed by the run guard.")


def main():
    try:
        outcome = decide(json.load(sys.stdin), "--coordinator" in sys.argv[1:])
    except Exception:
        return
    if outcome is None:
        return
    decision, reason = outcome
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": decision, "permissionDecisionReason": reason}}))


if __name__ == "__main__":
    main()
