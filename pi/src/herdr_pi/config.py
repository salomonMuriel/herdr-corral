import os
import tomllib
from datetime import time
from pathlib import Path

from pydantic import BaseModel, Field


class MachineConfig(BaseModel):
    name: str
    ssh: str
    hc: str = "~/.local/bin/hc"
    # Where the nightly board dump is copied on this machine.
    backup_dir: str = "~/.local/share/herdr-board"


class AlertsConfig(BaseModel):
    ntfy_url: str = "http://127.0.0.1:2586"
    topic: str = "herdr"
    agent_url: str = "https://pi.example.ts.net:8096/agents/{machine}/{address}"
    blocked_seconds: float = 120.0
    finished_seconds: float = 5.0
    # A window in front counts as away once nobody has touched the machine this long.
    idle_seconds: float = 120.0


class DigestConfig(BaseModel):
    # Pi local time. The digest covers the day up to this moment.
    at: time = time(19, 0)
    # Each agent's reports of the day, shown behind Recap in the Today view.
    recaps: bool = True
    url: str = "https://pi.example.ts.net:8096/"


class Settings(BaseModel):
    machines: list[MachineConfig] = Field(min_length=1)
    data_dir: Path = Path("/data")
    host: str = "127.0.0.1"
    port: int = 8095
    # The web page's own listener, reached only through `tailscale serve`.
    web_port: int = 8096
    web_logins: list[str] = Field(default_factory=list)
    # hc sends a heartbeat every 15 s, so a quiet stream this long is a dead connection.
    stall_seconds: float = 45.0
    # Pi local time. The command runs on the first machine that answers, in the order above.
    cleanup_at: time = time(3, 30)
    cleanup_command: str = "~/git/herdr-corral/scripts/nightly-cleanup"
    # The board's Postgres (herdr-db), dumped nightly at backup_at, Pi local time.
    db_port: int = 5440
    backup_at: time = time(3, 0)
    alerts: AlertsConfig = AlertsConfig()
    digest: DigestConfig = DigestConfig()

    @property
    def board_config(self) -> Path:
        return self.data_dir / "board.json"

    def machine(self, name: str) -> MachineConfig:
        for machine in self.machines:
            if machine.name == name:
                return machine
        raise KeyError(name)


def load_settings() -> Settings:
    path = Path(os.environ.get("HERDR_PI_CONFIG", Path(__file__).parents[2] / "config.toml"))
    values = tomllib.loads(path.read_text())
    if "HERDR_PI_DATA" in os.environ:
        values["data_dir"] = os.environ["HERDR_PI_DATA"]
    if "HERDR_PI_PORT" in os.environ:
        values["port"] = int(os.environ["HERDR_PI_PORT"])
    return Settings.model_validate(values)


def read_version() -> str:
    path = Path(os.environ.get("HERDR_PI_VERSION_FILE", "/app/VERSION"))
    try:
        return path.read_text().strip()
    except OSError:
        return "dev"
