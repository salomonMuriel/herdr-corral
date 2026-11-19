# Installing herdr-projects

Written so a coding agent can do the install for someone who already uses
[Herdr](https://herdr.dev). It works on one machine or several, and needs no server of its
own: the shared board is a free [Neon](https://neon.tech) Postgres database. An always-on
box for phone alerts and a web page is an optional extra, covered in
[docs/pi.md](docs/pi.md) and not needed for anything here.

It is safe on an existing Herdr setup. It adds a mod (`projects`), a layout
(`projects-dracula`) and a theme, adds key bindings for that layout only, and adds two
Claude Code hooks next to any you already have. Your other layouts, mods and settings stay
as they are, and `ctrl-alt-shift-escape` always goes back to Herdr's default layout.

## For the agent doing the install

- Steps marked **(person)** need the person: a sign-up, a browser login, a choice. Ask,
  wait, then continue.
- Run `scripts/doctor` (or `scripts/doctor --before-deploy` before step 8) whenever you want
  to know where things stand. Every failed check prints the command that fixes it. You're
  done when it prints `All good.` on every machine.
- Steps marked *each machine* must be repeated on every machine. Once the machines are
  linked (step 6), you can run commands on another one with `ssh <target> '<command>'`.
- Never commit `~/.config/herdr-board/config.json` or paste its contents anywhere: it
  holds the board's password.

## 0. Ask the person first (person)

1. **Which machines?** For each one: a short name (`desk`, `laptop`), its OS, and how the
   others reach it over SSH (`user@host`; with Tailscale the host is its MagicDNS name).
   A single machine is fine.
2. **How many agents may run at once on each machine?** Default 4. A big desktop can take 8.
3. **Neon:** do they have an account? You need either a Neon connection string they give
   you, or `neonctl` signed in to their account (`neonctl auth` opens a browser).
4. **Fork or clone?** Clone upstream to use it as is; fork it first if they want to
   customize it (deploys only ship what is pushed to the clone's `origin/main`).

## 1. Prerequisites (each machine)

macOS on Apple silicon, or Linux. Check each and install what's missing:

| Tool | Check | Install |
| --- | --- | --- |
| git | `git --version` | system package manager |
| GitHub CLI, signed in | `gh auth status` | https://cli.github.com, then `gh auth login` **(person)** |
| Python 3.10+ | `python3 --version` | system package manager |
| uv | `uv --version` | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| rsync | `rsync --version` | `brew install rsync` / `apt install rsync` |
| Claude Code | `claude --version` | https://claude.com/claude-code |

Also `~/.local/bin` must be on `PATH` in the shell agents start in, since that's where
`hb` goes. If `echo $PATH` doesn't show it, add `export PATH="$HOME/.local/bin:$PATH"` to
`~/.zshrc` or `~/.bashrc`.

On the one machine you'll run step 7 from: `psql` (`brew install libpq && brew link --force
libpq`, or `apt install postgresql-client`), or Docker, which `scripts/migrate` uses when
`psql` is missing.

With more than one machine, every machine must reach every other one over SSH without a
password prompt. [Tailscale](https://tailscale.com) with Tailscale SSH (`sudo tailscale up
--ssh` on Linux; on macOS use the Tailscale app's SSH setting or a normal key in
`~/.ssh/authorized_keys`) is the easiest way. Check with
`ssh -o BatchMode=yes <target> true` from each machine to each other one.

## 2. Herdr (each machine)

If `herdr-app --version` and `hc --version` don't both answer:

```sh
curl -fsSL https://releases.herdr.dev/app/install.sh | sh
```

Then open the Herdr app once **(person)**, so it creates `~/.config/herdr-app`.

## 3. Create the board (once)

With `neonctl` (`npm i -g neonctl`, then `neonctl auth` **(person)**):

```sh
neonctl projects create --name herdr-board --output json   # note the project id
neonctl connection-string --project-id <project id>
```

Or have the person create a project in the Neon console and copy the connection string
**(person)**. Use the direct one, not the `-pooler` one.

The string looks like
`postgresql://neondb_owner:<password>@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require`.
Then:

- `board.url` is the whole string.
- `board.host` is only its host: `ep-cool-name-123456.us-east-2.aws.neon.tech`, with no
  `https://`, port or path.

## 4. Clone the repo (each machine)

The path must be exactly `~/git/herdr-projects`, because the mod runs scripts from there.

```sh
git clone https://github.com/salomonMuriel/herdr-projects.git ~/git/herdr-projects
# or the person's fork
```

Their own repos should live under `~/git/` too (`~/git/<repo>` or `~/git/<group>/<repo>`);
that's where the sidebar looks for them.

## 5. Write the config (each machine)

```sh
mkdir -p ~/.config/herdr-board
cp ~/git/herdr-projects/examples/config.example.json ~/.config/herdr-board/config.json
chmod 600 ~/.config/herdr-board/config.json
hostname    # this machine's hostname, for "machines"
```

Fill it in. With two machines:

```json
{
  "machines": { "my-desktop": "desk", "Jo-MacBook-Air.local": "laptop" },
  "labels": { "desk": "desk", "laptop": "mac" },
  "hosts": {
    "desk": { "ssh": "jo@desk", "platform": "linux", "slots": 8 },
    "laptop": { "ssh": "jo@laptop", "platform": "macos", "slots": 4 }
  },
  "board": {
    "host": "ep-cool-name-123456.us-east-2.aws.neon.tech",
    "url": "postgresql://neondb_owner:...@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
  }
}
```

With one machine, `machines` and `hosts` have one entry each (its `ssh` can be left out).

| Key | Meaning |
| --- | --- |
| `machines` | each machine's `hostname` output → its short name |
| `labels` | how rows and cards show each machine (optional; defaults to the name) |
| `hosts.<name>.ssh` | how the other machines reach it |
| `hosts.<name>.platform` | `linux` or `macos` (picks the key bindings) |
| `hosts.<name>.slots` | tasks that may run there at once (default 4) |
| `board.host`, `board.url` | from step 3 |

The optional Pi adds `pi` and `standby` blocks; see [docs/pi.md](docs/pi.md).

The file is identical on every machine: write it once, then copy it
(`scp ~/.config/herdr-board/config.json <target>:.config/herdr-board/` and `chmod 600` there).

Verify: `python3 ~/git/herdr-projects/scripts/herdr_config.py self` prints this machine's
name, the same one used in `hosts`.

## 6. Link the machines (each machine; skip with one machine)

Herdr has to know every other machine by the same name as the config:

```sh
hc machine add <ssh target> --name <name> --install   # once per other machine
hc machine ls                                         # each shows "connected"
```

On `desk` that's `hc machine add jo@laptop --name laptop --install`; on `laptop`,
`hc machine add jo@desk --name desk --install`.

Now check each machine: `cd ~/git/herdr-projects && scripts/doctor --before-deploy`.
Everything up to the board should pass.

## 7. Create the tables (once, any machine)

```sh
cd ~/git/herdr-projects && scripts/migrate
```

It applies `schema/*.sql` in order and records each one in `schema_migrations`, so it
only applies new ones when run again.

## 8. Deploy (once, any machine)

```sh
cd ~/git/herdr-projects && scripts/deploy
```

It copies the mod, layout, theme, key bindings and `hb` tools to every machine in `hosts`
over SSH, adds the Claude Code hooks, runs `herdr-app check` on each and records the
deploy on the board. A machine it can't reach is skipped and catches up the next time its
Herdr window opens or comes forward. `scripts/deploy --local` deploys to this machine only.

## 9. Open it (each machine)

```sh
herdr-app do layout.switch --name projects-dracula
cd ~/git/herdr-projects && scripts/doctor     # should end with "All good."
```

Keys (Linux / macOS): `ctrl-alt-b` / `cmd-k` board, `ctrl-alt-y` / `cmd-y` Today,
`ctrl-alt-j` / `cmd-j` next agent that needs you, `ctrl-alt-n` / `cmd-shift-k` new task,
`ctrl-alt-s` / `cmd-shift-n` scratch session.

**(person)** Claude Code asks once whether it may trust a folder. Accepting it in a repo's
main checkout covers all its task worktrees, so open `claude` once in each repo they'll run
agents in and accept, or the first task there waits on "Waiting for folder trust".

Walk the person through a first task:

1. In the sidebar, add a project and one of their repos to it.
2. Open the board, add a task with a small, real change, and click **Run this chain**.
3. An agent starts on a new branch in its own worktree. When it runs `hb done`, the card
   moves to Review and its session waits for them.

## 10. Nightly cleanup (optional, one machine)

Finished tasks clean up their own worktree once merged. A nightly sweep also catches what
was left behind, on every machine, and shows the result in the sidebar footer. Add it to
one machine's crontab (`crontab -e`):

```cron
30 3 * * * $HOME/git/herdr-projects/scripts/nightly-cleanup >> $HOME/.cache/herdr-projects/nightly-cleanup.log 2>&1
```

`scripts/cleanup` (a dry run) lists the same things by hand.

## Adding a machine later

On the new machine do steps 1, 2, 4 and 6, add it to `machines` and `hosts` in the config,
copy the config to every machine, add the new machine on each existing one with
`hc machine add`, then run `scripts/deploy` from any machine.

## Updating

```sh
cd ~/git/herdr-projects && git pull --ff-only && scripts/migrate && scripts/deploy
```

With a fork, merge upstream into its `main` and push first. Windows that were closed
catch up when they next open.

## Uninstalling (each machine)

Switch layouts (`ctrl-alt-shift-escape`), then remove `~/.config/herdr-app/mods/projects`,
`~/.config/herdr-app/layouts/projects-dracula.json`,
`~/.local/bin/{hb,hb_coordinator.py,herdr-ask,herdr-approve,herdr-presence}`, the
`herdr-ask` and `herdr-approve` entries in `~/.claude/settings.json`, and
`~/.config/herdr-board`. Delete the Neon project to drop the board.

## When something is off

- `scripts/doctor` first.
- `herdr-app status` shows the window's errors; `~/.config/herdr-app/*.error` shows files
  Herdr refused.
- Logs are in `~/.cache/herdr-projects/`.
- A run doesn't start anything: the window of the run's machine must be open on
  `projects-dracula`.
- `Board config missing` in the sidebar: step 5 on that machine.
