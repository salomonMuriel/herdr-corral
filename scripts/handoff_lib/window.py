"""This machine's Herdr window, which shows both machines' spaces."""
import json
import posixpath
import subprocess

from handoff_lib.machines import HandoffError, self_name, tool


def herdr_do(*args: str) -> dict:
    result = subprocess.run([tool("herdr-app"), "do", *args], capture_output=True, text=True, timeout=60)
    payload = json.loads(result.stdout or "{}")
    if result.returncode != 0 or payload.get("error"):
        raise HandoffError(f"Herdr refused {args[0]}: {payload.get('error') or result.stderr.strip()}")
    return payload


def spaces() -> list[dict]:
    result = subprocess.run([tool("herdr-app"), "ls"], capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise HandoffError(f"herdr-app ls failed: {result.stderr.strip()}")
    return json.loads(result.stdout)["spaces"]


def repo_space(machine: str, repo: str) -> str | None:
    """An open space of that repo on that machine, the way launchSession reuses one."""
    wanted = None if machine == self_name() else machine
    for space in spaces():
        folder = space.get("folder") or ""
        if space.get("machine") == wanted and (folder == repo or folder.startswith(f"{repo}/")):
            return space["id"]
    return None


def open_tab(machine: str, repo: str, folder: str, name: str, argv: list[str], message: str) -> str:
    """Starts argv in a new tab on that machine and returns the tab's canonical id."""
    launch = ["--folder", folder, "--argv", json.dumps(argv), "--task", message]
    space = repo_space(machine, repo)
    if space:
        made = herdr_do("tab.new", "--space", space, "--name", name, *launch)
    else:
        target = "" if machine == self_name() else machine
        made = herdr_do("space.new", "--machine", target, "--name", posixpath.basename(repo), "--tab", name, *launch)
    tab = made.get("tab")
    if not tab:
        raise HandoffError(f"Herdr made no tab: {made}")
    return tab if "/" in tab else f"{self_name()}/{tab}"


def close_tab(window_tab: str) -> None:
    herdr_do("tab.close", "--id", window_tab, "--confirmed", "true")


def tab_name(window_tab: str) -> str | None:
    for space in spaces():
        for tab in space.get("tabs", []):
            if tab["id"] == window_tab:
                return tab.get("name")
    return None
