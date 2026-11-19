"""Read Claude Code's settings.json on stdin, add the herdr hooks beside the existing ones, print the result.

Other hooks stay as they are; earlier herdr-ask and herdr-approve entries are replaced.
"""
import json
import sys

MARKS = ("herdr-ask", "herdr-approve")
ASK = '"$HOME/.local/bin/herdr-ask" {}'
# The page can answer for this long; Claude Code's own prompt shows the whole time.
APPROVE_SECONDS = 900
APPROVE = {
    "type": "command",
    "command": f'"$HOME/.local/bin/herdr-approve" {APPROVE_SECONDS}',
    "timeout": APPROVE_SECONDS + 30,
}
ASK_EVENTS = {
    "PermissionRequest": "set",
    "UserPromptSubmit": "prompt",
    "PostToolUse": "clear",
    "PostToolUseFailure": "clear",
    "Stop": "clear",
    "StopFailure": "clear",
    "SessionEnd": "clear",
}


def is_ours(group: dict) -> bool:
    return any(mark in hook.get("command", "") for hook in group.get("hooks", []) for mark in MARKS)


def ask_group(action: str) -> dict:
    return {"matcher": "", "hooks": [{"type": "command", "command": ASK.format(action), "timeout": 10, "async": True}]}


def our_groups(event: str) -> list[dict]:
    groups = [ask_group(ASK_EVENTS[event])]
    if event == "PermissionRequest":
        groups.append({"matcher": "", "hooks": [APPROVE]})
    return groups


def merge_hooks(settings: dict) -> dict:
    hooks = dict(settings.get("hooks") or {})
    for event in ASK_EVENTS:
        kept = [group for group in hooks.get(event, []) if not is_ours(group)]
        hooks[event] = [*kept, *our_groups(event)]
    return {**settings, "hooks": hooks}


def main() -> None:
    text = sys.stdin.read()
    settings = json.loads(text) if text.strip() else {}
    merged = merge_hooks(settings)
    if merged == settings:
        sys.stdout.write(text)
        return
    json.dump(merged, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
