#!/usr/bin/env python3
"""Reviews a task's branch with Claude Code's /code-review and writes the verdict as JSON.

The window of the task's machine starts it detached and reads --out when it lands:
{"ok": true, "findings": [{"file", "line", "problem"}], "summary"} or {"ok": false, "error"}.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

TIMEOUT_S = 40 * 60
GUARD = Path(__file__).with_name("run_guard.py")
# The window starts this with its own PATH, which can miss where claude and git live.
EXTRA_PATH = ["~/.local/bin", "~/.claude/local", "/opt/homebrew/bin", "/usr/local/bin"]

VERDICT_SCHEMA = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "file": {"type": "string"},
                    "line": {"type": "integer"},
                    "problem": {"type": "string"},
                },
                "required": ["file", "problem"],
            },
        },
        "summary": {"type": "string"},
    },
    "required": ["findings", "summary"],
}

PROMPT = """Run the /code-review skill (args: medium) on this task's changes, then give your verdict in the required JSON.

The changes are every commit on branch {branch} since it left {base}, plus anything uncommitted: `git diff {base}...HEAD` and `git status`. You are in the task's worktree. Read code as much as you need, but don't edit anything.

The task these changes were written for:

Title: {title}

Notes:
{notes}

Report only real issues: bugs, broken behaviour, data loss, security holes, things that will fail in production, and clear violations of the task's own requirements above. No style, naming, formatting, "consider", or speculative nitpicks. If nothing real is found, say so and pass with an empty findings list.

Each finding names the file, the line when there is one, and in one or two sentences what breaks and when. This is review round {round} of 3."""


def search_path() -> str:
    extra = [str(Path(p).expanduser()) for p in EXTRA_PATH]
    return os.pathsep.join([os.environ.get("PATH", ""), *extra])


def find_claude(path: str) -> str:
    found = shutil.which("claude", path=path)
    if not found:
        raise RuntimeError("claude isn't installed on this machine")
    return found


def guard_settings() -> str:
    hook = {"type": "command", "command": f"python3 {GUARD}"}
    return json.dumps({"hooks": {"PreToolUse": [{"matcher": "*", "hooks": [hook]}]}})


def review(args: argparse.Namespace) -> dict:
    prompt = PROMPT.format(branch=args.branch, base=args.base, title=args.title, notes=args.notes or "(none)", round=args.round)
    path = search_path()
    command = [
        find_claude(path), "-p", prompt,
        "--output-format", "json",
        "--json-schema", json.dumps(VERDICT_SCHEMA),
        "--settings", guard_settings(),
        "--disallowedTools", "Edit", "Write", "NotebookEdit",
    ]
    done = subprocess.run(command, cwd=args.worktree, capture_output=True, text=True, timeout=TIMEOUT_S,
                          stdin=subprocess.DEVNULL, env={**os.environ, "PATH": path})
    if done.returncode != 0:
        raise RuntimeError(f"claude exited with {done.returncode}: {(done.stderr or done.stdout).strip()[-400:]}")
    reply = json.loads(done.stdout)
    verdict = reply.get("structured_output")
    if reply.get("is_error") or not isinstance(verdict, dict):
        raise RuntimeError(f"no verdict from claude: {str(reply.get('result'))[-400:]}")
    findings = [f for f in verdict.get("findings", []) if isinstance(f, dict) and f.get("problem")]
    return {"ok": True, "findings": findings, "summary": verdict.get("summary", "")}


def write_result(out: Path, result: dict) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    partial = out.with_suffix(".partial")
    partial.write_text(json.dumps(result))
    os.replace(partial, out)


def main() -> None:
    parser = argparse.ArgumentParser()
    for name in ("--worktree", "--base", "--branch", "--round", "--out", "--title"):
        parser.add_argument(name, required=True)
    parser.add_argument("--notes", default="")
    args = parser.parse_args()
    try:
        result = review(args)
    except subprocess.TimeoutExpired:
        result = {"ok": False, "error": f"the review took over {TIMEOUT_S // 60} minutes"}
    except Exception as error:
        result = {"ok": False, "error": str(error)}
    write_result(Path(args.out), result)
    print(json.dumps(result))
    sys.exit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
