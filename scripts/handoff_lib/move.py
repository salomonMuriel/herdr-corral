"""Moving a session: stop it at a turn boundary, carry its worktree and conversation, start it
on the target, point its card there and close the old tab."""
import posixpath
import time
from dataclasses import dataclass, field

from handoff_lib import board, conversation, messages, terminal, tree, window
from handoff_lib.machines import HandoffError, home, label, move_home, run

SUMMARY_WAIT_S = 20 * 60


def say(text: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {text}", flush=True)


@dataclass
class Plan:
    source: terminal.Terminal
    target: str
    link: board.Link | None
    full: bool
    homes: dict[str, str]
    place: tree.Place | None = None
    target_main: str = ""
    target_root: str = ""
    target_cwd: str = ""
    talk: conversation.Conversation | None = None
    summary: str = ""
    made: list[str] = field(default_factory=list)

    @property
    def old_home(self) -> str:
        return self.homes[self.source.machine]

    @property
    def new_home(self) -> str:
        return self.homes[self.target]


def plan(address: str, target: str, summary_only: bool, repo: str | None) -> Plan:
    source = terminal.load(address)
    if source.machine == target:
        raise HandoffError(f"{address} already runs on {target}")
    if source.status == "blocked":
        raise HandoffError(f"{address} is waiting on a prompt; answer it first")
    link = board.find(source.canonical_tab)
    full = source.is_claude and not summary_only
    if not full and not link:
        raise HandoffError("only Claude Code sessions move with their conversation; others need a task for the summary handoff")
    moving = Plan(source=source, target=target, link=link, full=full,
                  homes={source.machine: home(source.machine), target: home(target)})
    moving.target_main = repo or ""
    return moving


def settle(moving: Plan) -> None:
    """Waits for the turn to end; the summary handoff then asks the agent for its notes."""
    say(f"Waiting for {moving.source.address} to finish its turn")
    if terminal.wait_idle(moving.source) == "blocked":
        raise HandoffError(f"{moving.source.address} is waiting on a prompt; answer it first")
    if moving.full:
        moving.talk = conversation.find(moving.source.machine, moving.source.pid)
        return
    moving.summary = ask_summary(moving)


def ask_summary(moving: Plan) -> str:
    before = moving.link.reported_at
    say("Asking the agent for a handoff summary")
    terminal.send(moving.source, messages.summary_request(moving.target))
    deadline = time.monotonic() + SUMMARY_WAIT_S
    while time.monotonic() < deadline:
        terminal.wait_idle(moving.source)
        latest = board.refresh(moving.link)
        if latest.reported_at != before and (latest.report or "").strip():
            return latest.report.strip()
        time.sleep(5)
    raise HandoffError("the agent wrote no handoff summary")


def locate(moving: Plan) -> None:
    cwd = moving.talk.cwd if moving.talk else moving.source.cwd
    place = tree.inspect(moving.source.machine, cwd)
    moving.place = place
    moving.target_main = moving.target_main or move_home(place.main, moving.old_home, moving.new_home)
    moving.target_root = moving.target_main + place.root[len(place.main):]
    moving.target_cwd = posixpath.join(moving.target_root, place.relative) if place.relative else moving.target_root
    if not place.is_worktree and not tree.is_clean(place):
        raise HandoffError(f"{place.root} is a main checkout with uncommitted changes; commit them first")
    tree.check_target(place, moving.target_main, moving.target_root, moving.target)


def stop(moving: Plan) -> None:
    if not moving.full:
        return
    say("Stopping Claude Code")
    terminal.exit_claude(moving.source)


def carry_tree(moving: Plan) -> None:
    place = moving.place
    if not place.is_worktree:
        head = run(moving.target, ["git", "-C", moving.target_main, "rev-parse", "HEAD"]).stdout.decode().strip()
        if head != place.head:
            say(f"Note: {moving.target_main} on {moving.target} is at {head[:12]}, the source at {place.head[:12]}")
        return
    say(f"Committing the work in progress to {place.handoff_ref}")
    tree.snapshot(place, moving.target)
    say(f"Carrying it to {moving.target}")
    tree.carry(place, moving.target_main, moving.target)
    tree.check_out(place, moving.target_main, moving.target_root, moving.target)
    moving.made.append("worktree")


def carry_conversation(moving: Plan) -> None:
    if not moving.full:
        return
    talk = moving.talk
    folder = conversation.project_folder(moving.new_home, moving.target_cwd)
    replacements = [(talk.folder, folder), (moving.place.root, moving.target_root)]
    say(f"Copying conversation {talk.session_id}")
    conversation.copy(talk, moving.target, folder, replacements)
    moving.made.append("conversation")


def target_argv(moving: Plan) -> list[str]:
    """The source's program and flags with the target's home; the program by name, since it may
    live elsewhere there."""
    flags, _ = terminal.split_argv(moving.source.argv)
    moved = [posixpath.basename(flags[0]), *(arg.replace(moving.old_home, moving.new_home) for arg in flags[1:])]
    return [*moved, "--resume", moving.talk.session_id] if moving.full else moved


def first_message(moving: Plan) -> str:
    place = moving.place
    if moving.full:
        return messages.resumed(moving.source.machine, moving.target, place.root, moving.target_root,
                                moving.old_home, moving.new_home)
    # A resumed session's message is the resume notice, not the task's first message.
    _, positional = terminal.split_argv(moving.source.argv)
    fresh = positional and not terminal.was_resumed(moving.source.argv)
    original = positional[-1].replace(place.root, moving.target_root) if fresh else ""
    return messages.takeover(original, moving.link.title, moving.link.notes, moving.source.machine,
                             moving.target_root, place.branch, moving.summary)


def tab_title(moving: Plan) -> str:
    return (moving.link.title if moving.link else None) or window.tab_name(moving.source.window_tab) or "Moved session"


def start(moving: Plan) -> str:
    say(f"Starting it on {moving.target} in {moving.target_cwd}")
    return window.open_tab(moving.target, moving.target_main, moving.target_cwd, tab_title(moving),
                           target_argv(moving), first_message(moving))


def roll_back(moving: Plan) -> None:
    """Undoes the target's copies and resumes the conversation on the source in a new tab."""
    if "conversation" in moving.made:
        folder = conversation.project_folder(moving.new_home, moving.target_cwd)
        run(moving.target, ["rm", "-f", f"{folder}/{moving.talk.session_id}.jsonl"])
    if "worktree" in moving.made:
        run(moving.target, ["git", "-C", moving.target_main, "worktree", "remove", "--force", moving.target_root])
    if not moving.talk:
        return
    say(f"Resuming the conversation on {moving.source.machine} again")
    flags, _ = terminal.split_argv(moving.source.argv)
    tab = window.open_tab(moving.source.machine, moving.place.main, moving.talk.cwd, tab_title(moving),
                          [*flags, "--resume", moving.talk.session_id], messages.stayed(moving.source.machine, moving.target))
    if moving.link:
        board.relink(moving.link, tab, moving.source.machine)
    window.close_tab(moving.source.window_tab)


def finish(moving: Plan, new_tab: str, keep_source: bool) -> list[str]:
    """Each step after the start is attempted even when one before it fails."""
    outcomes = []
    steps = [
        ("pointing the card at the new session", lambda: moving.link and board.relink(moving.link, new_tab, moving.target)),
        ("archiving the source transcript", lambda: moving.talk and conversation.archive(moving.talk, moving.target)),
        ("closing the old tab", lambda: window.close_tab(moving.source.window_tab)),
    ]
    for what, step in steps:
        try:
            step()
        except HandoffError as error:
            outcomes.append(f"failed {what}: {error}")
    if moving.place.is_worktree and not keep_source:
        try:
            outcomes.append(tree.remove_source(moving.place))
        except HandoffError as error:
            outcomes.append(f"kept the source worktree: {error}")
    return outcomes


def move(address: str, target: str, summary_only: bool = False, keep_source: bool = False, repo: str | None = None) -> None:
    moving = plan(address, target, summary_only, repo)
    settle(moving)
    locate(moving)
    stop(moving)
    try:
        carry_tree(moving)
        carry_conversation(moving)
        new_tab = start(moving)
    except Exception:
        try:
            roll_back(moving)
        except HandoffError as error:
            say(f"Rolling back failed too: {error}")
        raise
    outcomes = finish(moving, new_tab, keep_source)
    how = "with its conversation" if moving.full else "from a handoff summary"
    report = f"Moved to {label(target)} {how}"
    if moving.link:
        try:
            board.note(moving.link, report)
        except HandoffError as error:
            outcomes.append(f"failed writing the card: {error}")
    say(f"{report}: {new_tab}")
    for line in outcomes:
        say(line)
