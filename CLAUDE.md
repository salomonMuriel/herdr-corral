# herdr-projects

Installing it? Follow `INSTALL.md` and check with `scripts/doctor`.

`README.md` describes how the system works. When you
change behaviour, update the section that describes it in the same commit.

- Agents working on this repo run inside the Herdr app it customizes. A broken mod can take
  the window down: check with `herdr-app check mods/projects` before calling work done, and
  avoid circular imports between mod files.
- Don't edit `~/.config/herdr-app` directly and don't run `scripts/deploy`, `deploy-pi` or
  `deploy-standby` unless the person asks. Editing and testing deploy code is fine.
- Nothing machine-specific goes in the repo: machine names, SSH targets, hosts and secrets
  come from `~/.config/herdr-board/config.json` (read by `scripts/herdr_config.py`) and
  `~/.config/herdr-board/pi.toml`.
- Pi service tests: `cd pi && uv run pytest`. Scripts: `bash -n` for shell.
- A schema change is a new idempotent file in `schema/`, applied with `scripts/migrate`.
