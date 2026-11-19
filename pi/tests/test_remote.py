from pathlib import Path

from herdr_pi.config import MachineConfig, Settings
from herdr_pi.remote import HcResult, Remote, parse_error


def test_argv_quotes_arguments_but_not_the_hc_path() -> None:
    machine = MachineConfig(name="laptop", ssh="me@laptop")
    remote = Remote(Settings(machines=[machine], data_dir=Path("/data")))
    argv = remote.argv(machine, ["send", "t3", "it's done; rm -rf ~"])
    assert argv[-2] == "me@laptop"
    assert argv[-1] == "~/.local/bin/hc send t3 'it'\"'\"'s done; rm -rf ~'"
    assert "UserKnownHostsFile=/data/known_hosts" in argv


def test_parse_error_reads_hc_errors_and_ssh_failures() -> None:
    hc_error = parse_error("laptop", HcResult(3, "", '{"error": {"kind": "not_found", "message": "no t99"}}'))
    assert (hc_error.kind, hc_error.message) == ("not_found", "no t99")
    ssh_error = parse_error("laptop", HcResult(255, "", "ssh: connect to host laptop port 22: timed out\n"))
    assert ssh_error.kind == "unreachable"
