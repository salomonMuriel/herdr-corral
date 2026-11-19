import re
from pathlib import Path

REPORTING_JS = Path(__file__).resolve().parent.parent.parent / "mods/projects/reporting.js"


def reporting_note() -> str:
    match = re.search(r'REPORTING_NOTE = "((?:[^"\\]|\\.)*)"', REPORTING_JS.read_text())
    return match.group(1).replace('\\"', '"') if match else ""


def resumed(source: str, target: str, old_root: str, new_root: str, old_home: str, new_home: str) -> str:
    return (f"This session moved from {source} to {target}. Its worktree is now {new_root} (it was {old_root}),"
            f" on the same branch, with the uncommitted changes. Paths under {old_home} are under {new_home} here,"
            f" and anything that only exists on {source} may be missing. Carry on where you left off;"
            " if you were waiting for the person, keep waiting.")


def stayed(source: str, target: str) -> str:
    return (f"The move to {target} failed, so this session stays on {source}. Carry on where you left off;"
            " if you were waiting for the person, keep waiting.")


def summary_request(target: str) -> str:
    return (f"This session is moving to {target}, where a fresh agent takes over from your notes. Stop the work in"
            " progress and don't commit: the move carries your uncommitted changes. Write a handoff summary for that"
            " agent with `hb note \"Handoff: <summary>\"`: what is done, what is left, decisions made and anything"
            " that will trip it up. Then stop.")


def takeover(first_message: str, title: str, notes: str, source: str, new_root: str, branch: str | None, summary: str) -> str:
    opening = first_message or "\n\n".join(part for part in (title, notes, (
        f"You are in this task's own git worktree ({new_root}, branch {branch or 'detached'}). Work and commit only"
        " here."), reporting_note()) if part)
    return (f"{opening}\n\nYou take over this task from an agent that worked on it on {source}. The worktree came"
            f" along with its uncommitted changes. Its handoff summary:\n\n{summary}")
