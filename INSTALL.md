# Installing herdr-projects

Written for a person or a coding agent doing the install. Steps marked **(you)** need a
person: an account sign-up, a browser login, or a choice only you can make. Everything else
an agent can run.

You can start with one machine and add more later. The Pi is optional: without it you
lose phone alerts, the tailnet web page, the nightly cleanup and the daily digest, and
everything else works.

## 1. Requirements

On every machine (macOS on Apple silicon, or Linux):

| Tool | Why | Check |
| --- | --- | --- |
| [Herdr](https://herdr.dev) app and herdr-core (`hc`) | the window and the terminals | `herdr-app --version`, `hc --version` |
| git, [gh](https://cli.github.com) signed in | worktrees, PRs, issues | `gh auth status` |
| Python 3.10+ and [uv](https://docs.astral.sh/uv/) | `hb`, cleanup, handoff | `python3 --version`, `uv --version` |
| rsync | deploy | `rsync --version` |
| [Claude Code](https://claude.com/claude-code) | the agents (Codex works for sessions; runs and code review use Claude Code) | `claude --version` |

On the machine you set the board up from: `psql` 16 or newer.

With more than one machine: [Tailscale](https://tailscale.com) on all of them, and SSH from
each machine to every other one without a password prompt (Tailscale SSH, `tailscale up
--ssh`, is the easiest).

Optional: [`neonctl`](https://neon.tech/docs/reference/neon-cli) to create the board and to
include Neon branches in cleanup; a Raspberry Pi or any small Linux box with Docker for
`herdr-pi`.

Install Herdr:

```sh
curl -fsSL https://releases.herdr.dev/app/install.sh | sh
```

Open it once so it creates `~/.config/herdr-app`.

## 2. Name your machines

Pick a short name per machine, like `desk` and `laptop`. The same names go in three places:
Herdr's machine list, the config file, and (with a Pi) `pi.toml`.

On each machine, add every other machine to herdr-core under its name:

```sh
hc machine add you@laptop --name laptop     # run on desk
hc machine add you@desk --name desk         # run on laptop
hc machine ls                               # each should be "connected"
```

Note each machine's `hostname` output; the config maps it to the name.

## 3. Create the board

The board is a Postgres database spoken to over Neon's HTTP `/sql` protocol. Pick one:

**A. Neon (simplest).** **(you)** Sign up at [neon.tech](https://neon.tech) (the free plan is
enough), then:

```sh
neonctl projects create --name herdr-board
neonctl connection-string --project-id <id>     # postgresql://...@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
```

The board's `host` is the host part of that string (`ep-xxx.region.aws.neon.tech`) and its
`url` is the whole string.

**B. Your own Pi.** Set up the Pi first (section 8). Its `herdr-sql` gateway is the
`host` (`pi.your-tailnet.ts.net:8097`) and the `url` is
`postgresql://herdr:<POSTGRES_PASSWORD>@pi.your-tailnet.ts.net:5440/herdr`, with the password
from `~/herdr-pi/data/db.env` on the Pi.

## 4. Fork and clone

`scripts/deploy` only deploys a `main` that matches `origin/main`, so you need a repo you
can push to. **(you)** Fork this repo on GitHub (private is fine), then on every machine:

```sh
git clone git@github.com:<you>/herdr-projects.git ~/git/herdr-projects
```

The path matters: the mod runs scripts from `~/git/herdr-projects`. Your own repos go under
`~/git/` too (`~/git/<repo>` or `~/git/<group>/<repo>`).

## 5. Write the config

On every machine, create `~/.config/herdr-board/config.json` from
[`examples/config.example.json`](examples/config.example.json), mode 600. It holds the
board's password, so it never goes in a repo.

```sh
mkdir -p ~/.config/herdr-board
cp ~/git/herdr-projects/examples/config.example.json ~/.config/herdr-board/config.json
chmod 600 ~/.config/herdr-board/config.json
```

| Key | Meaning |
| --- | --- |
| `machines` | `hostname` output → machine name, for every machine |
| `labels` | short name shown on rows and cards (optional) |
| `hosts.<name>.ssh` | how the other machines reach it (`user@host`) |
| `hosts.<name>.platform` | `linux` or `macos`, for key bindings |
| `hosts.<name>.slots` | how many tasks may run there at once (default 4) |
| `board.host`, `board.url` | from step 3 |
| `pi.ssh`, `pi.host`, `pi.dir` | only with a Pi (section 8) |
| `standby.host`, `standby.dir` | only with a standby (section 8) |

Delete the `pi` and `standby` blocks if you don't use them. The file is the same on every
machine; copy it over once it's right.

Check it:

```sh
cd ~/git/herdr-projects
python3 scripts/herdr_config.py self        # this machine's name
python3 scripts/herdr_config.py machines    # every machine
```

## 6. Create the tables

From one machine:

```sh
cd ~/git/herdr-projects && scripts/migrate
```

It applies `schema/*.sql` in order. Each migration is idempotent, so it's safe to run again
after pulling new ones.

## 7. Deploy and open

From one machine (it reaches the others over SSH):

```sh
cd ~/git/herdr-projects && scripts/deploy
```

It copies the mod, layout, theme, key bindings and `bin/` tools to every machine, adds the
Claude Code hooks to `~/.claude/settings.json` next to any you have, checks the mod and
records the deploy. A machine it can't reach catches up when its window next opens.
`scripts/deploy --local` deploys to this machine only.

Make sure `~/.local/bin` is on your `PATH` (`hb` and the hooks live there). Then switch the
window to the layout:

```sh
herdr-app do layout.switch --name projects-dracula
herdr-app status        # should show no errors
```

Keys: `ctrl-alt-b` / `cmd-k` board, `ctrl-alt-y` / `cmd-y` Today, `ctrl-alt-j` / `cmd-j` next
agent that needs you, `ctrl-alt-s` / `cmd-shift-n` scratch session (Linux / macOS).
`ctrl-alt-shift-escape` always goes back to Herdr's default layout.

**(you)** Claude Code asks once per repo whether you trust its folder. Accept it in the main
checkout of each repo you'll run agents in, so task worktrees start without stopping.

### Try it

1. In the sidebar, add a project and one of your repos to it.
2. Open its board, add a task, and click **Run this chain** on the card.
3. An agent starts in a new worktree. When it runs `hb done`, the card moves to Review.

## 8. Optional: the Pi

Any always-on Linux box with Docker and Tailscale works.

1. Install Docker and Tailscale there and enable Tailscale SSH and HTTPS certificates for
   your tailnet (**(you)**: the Tailscale admin console, DNS → HTTPS Certificates).
2. Each of your machines must accept SSH from the Pi (Tailscale SSH does it), since the
   service follows `hc events` on each one.
3. Fill in the `pi` block of `config.json` and copy `pi/config.example.toml` to
   `~/.config/herdr-board/pi.toml` on the machine you deploy from. Set `web_logins` to your
   Tailscale login, the machines, and the URLs with your Pi's tailnet name.
4. Deploy it:

   ```sh
   scripts/deploy-pi
   ```

   It creates the database passwords on first run, brings up `herdr-db`, `herdr-sql`,
   `herdr-pi` and `herdr-ntfy`, and publishes them on the tailnet with `tailscale serve`
   (never funnel).
5. To keep the board on the Pi, point `board` at it (section 3, option B) and run
   `scripts/migrate`.
6. **(you)** Phone alerts: install the ntfy app, add the server `https://<pi host>:2586` and
   subscribe to `herdr`.

A standby of the Pi's board on one of your machines is optional too: fill in the
`standby` block and run `scripts/deploy-standby` on that machine. README.md, "Board
database", covers failover.

## Updating

Pull or merge upstream into your fork's `main`, push, run `scripts/migrate` if `schema/`
changed, then `scripts/deploy`. Windows that were closed catch up when they next open.

## Uninstalling

Switch to another layout (`ctrl-alt-shift-escape`), then remove
`~/.config/herdr-app/mods/projects`, `~/.config/herdr-app/layouts/projects-dracula.json`,
`~/.local/bin/{hb,hb_coordinator.py,herdr-ask,herdr-approve,herdr-presence}` and the
`herdr-ask` / `herdr-approve` entries in `~/.claude/settings.json`.

## When something is off

- `herdr-app status` and `~/.config/herdr-app/*.error` show what the window refused.
- `herdr-app check ~/.config/herdr-app/mods/projects` checks the mod.
- Logs: `~/.cache/herdr-projects/`.
- "Board config missing": step 5 on that machine.
- A run doesn't start: the window of the run's machine must be open on `projects-dracula`.
