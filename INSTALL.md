# Installing herdr-projects

Written so a coding agent can do the install for someone who already uses
[Herdr](https://herdr.dev), on one machine or several. The shared board needs a Postgres
database: the recommended setup is Postgres on a small always-on box on your tailnet, and
Neon, Supabase or any other Postgres work too ([docs/database.md](docs/database.md)).

It is safe on an existing Herdr setup. It adds a mod (`projects`), a layout
(`projects-dracula`) and a theme, adds key bindings for that layout only, and adds two
Claude Code hooks next to any you already have. Your other layouts, mods and settings stay
as they are, and `ctrl-alt-shift-escape` always goes back to Herdr's default layout.

## For the agent doing the install

- Steps marked **(person)** need the person: a sign-up, a browser login, a choice. Ask,
  wait, then continue.
- Run `scripts/doctor` (`scripts/doctor --before-deploy` before step 9) whenever you want
  to know where things stand. Every failed check prints the command that fixes it. You're
  done when it prints `All good.` on every machine.
- Steps marked *each machine* are repeated on every machine. Once the machines share a
  tailnet (step 2), you can run commands on another one with `ssh <target> '<command>'`.
- Never commit `~/.config/herdr-board/config.json` or paste its contents anywhere: it
  holds the board's password.

## 0. Ask the person first (person)

1. **Which machines?** For each one: a short name (`desk`, `laptop`) and its OS. A single
   machine is fine.
2. **A tailnet?** Recommended: every machine (and the board's box) on one
   [Tailscale](https://tailscale.com) network. Do they have a Tailscale account?
3. **Where should the board live?** Recommend, in this order:
   1. their own always-on box (a Raspberry Pi, a NAS, a home server) running Postgres,
      which is how the maintainers run it;
   2. Neon, if they want nothing to run;
   3. Supabase or a Postgres they already have.

   [docs/database.md](docs/database.md) compares them.
4. **How many agents may run at once on each machine?** Default 4. A big desktop can take 8.
5. **Fork or clone?** Clone upstream to use it as is; fork it first if they want to
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

`~/.local/bin` must be on `PATH` in the shell agents start in, since that's where `hb`
goes. If `echo $PATH` doesn't show it, add `export PATH="$HOME/.local/bin:$PATH"` to
`~/.zshrc` or `~/.bashrc`.

On the machine you'll run step 8 from: `psql` (`brew install libpq && brew link --force
libpq`, or `apt install postgresql-client`), or Docker, which `scripts/migrate` uses when
`psql` is missing.

## 2. Put the machines on a tailnet (each machine, recommended)

With more than one machine, each must reach every other one over SSH without a password
prompt: herdr-core shows and drives other machines' agents over SSH, and `scripts/deploy`
copies over it. A tailnet gives every machine a stable name and encrypted links wherever it
is, and Tailscale SSH needs no keys. The recommended board box (and the optional phone
alerts and web page) are reached through it too.

1. **(person)** Create a Tailscale account if they have none, then install Tailscale on
   every machine and log in to the same account (https://tailscale.com/download).
2. In the admin console (https://login.tailscale.com/admin/dns) **(person)**: turn on
   MagicDNS, and HTTPS certificates if the board will live on their own box.
3. Enable Tailscale SSH on each Linux machine: `sudo tailscale up --ssh`. On macOS the App
   Store app can't serve SSH; turn on Remote Login (System Settings → General → Sharing)
   and add the other machines' public keys to `~/.ssh/authorized_keys`, or use the
   open-source `tailscaled` (`brew install tailscale`), which can.
4. Check from each machine to each other one: `tailscale status` lists them, and
   `ssh -o BatchMode=yes <user>@<machine> true` returns without a prompt.

Use each machine's MagicDNS name (`desk`, or `desk.your-tailnet.ts.net`) as its SSH host
below. Without Tailscale, any SSH that works the same way is fine.

With a single machine and a board on Neon or Supabase, this step is optional.

## 3. Herdr (each machine)

If `herdr-app --version` and `hc --version` don't both answer:

```sh
curl -fsSL https://releases.herdr.dev/app/install.sh | sh
```

Then open the Herdr app once **(person)**, so it creates `~/.config/herdr-app`.

## 4. Clone the repo (each machine)

The path must be exactly `~/git/herdr-projects`, because the mod runs scripts from there.

```sh
git clone https://github.com/salomonMuriel/herdr-projects.git ~/git/herdr-projects
# or the person's fork
```

Their own repos should live under `~/git/` too (`~/git/<repo>` or `~/git/<group>/<repo>`);
that's where the sidebar looks for them.

## 5. Write the config (one machine first)

```sh
mkdir -p ~/.config/herdr-board
cp ~/git/herdr-projects/examples/config.example.json ~/.config/herdr-board/config.json
chmod 600 ~/.config/herdr-board/config.json
hostname    # run on each machine, for "machines"
```

Fill in everything but `board`, which step 6 fills. With two machines:

```json
{
  "machines": { "my-desktop": "desk", "Jo-MacBook-Air.local": "laptop" },
  "labels": { "desk": "desk", "laptop": "mac" },
  "hosts": {
    "desk": { "ssh": "jo@desk", "platform": "linux", "slots": 8 },
    "laptop": { "ssh": "jo@laptop", "platform": "macos", "slots": 4 }
  },
  "board": { "host": "", "url": "" }
}
```

With one machine, `machines` and `hosts` have one entry each (its `ssh` can be left out).

| Key | Meaning |
| --- | --- |
| `machines` | each machine's `hostname` output → its short name |
| `labels` | how rows and cards show each machine (optional; defaults to the name) |
| `hosts.<name>.ssh` | how the other machines reach it (step 2) |
| `hosts.<name>.platform` | `linux` or `macos` (picks the key bindings) |
| `hosts.<name>.slots` | tasks that may run there at once (default 4) |
| `board.host`, `board.url` | step 6 |
| `pi` | the board's box, with option 1 of step 6 |

Verify: `python3 ~/git/herdr-projects/scripts/herdr_config.py self` prints this machine's
name, the same one used in `hosts`.

## 6. Set up the board's database (once)

Follow the option the person picked in [docs/database.md](docs/database.md). Each one ends
with `board.host` and `board.url` filled in on this machine:

- **Own box (recommended):** set it up as described there, add the `pi` block, then
  `scripts/deploy-pi --board-only --set-board`.
- **Neon:** create a project and paste its host and connection string.
- **Supabase or any other Postgres:** paste its connection string into `board.url`, then
  `scripts/deploy-gateway` on an always-on machine with Docker.

Then copy the finished config to every other machine and lock it down there:

```sh
scp ~/.config/herdr-board/config.json <user>@<machine>:.config/herdr-board/config.json
ssh <user>@<machine> 'chmod 600 ~/.config/herdr-board/config.json'
```

(Create `~/.config/herdr-board` there first.) The file is identical on every machine.

## 7. Link the machines in Herdr (each machine; skip with one machine)

Herdr has to know every other machine by the same name as the config:

```sh
hc machine add <ssh target> --name <name> --install   # once per other machine
hc machine ls                                         # each shows "connected"
```

On `desk` that's `hc machine add jo@laptop --name laptop --install`; on `laptop`,
`hc machine add jo@desk --name desk --install`.

Check each machine: `cd ~/git/herdr-projects && scripts/doctor --before-deploy`. Everything
up to the board should pass.

## 8. Create the tables (once, any machine)

```sh
cd ~/git/herdr-projects && scripts/migrate
```

On an empty database it applies `schema/0001_board.sql`, which creates the whole board,
and records it in `schema_migrations`. Run it again after updates; it only applies files the
board doesn't have yet. On Supabase, run the row-level security step from
docs/database.md now.

## 9. Deploy (once, any machine)

```sh
cd ~/git/herdr-projects && scripts/deploy
```

It copies the mod, layout, theme, key bindings and `hb` tools to every machine in `hosts`
over SSH, adds the Claude Code hooks, runs `herdr-app check` on each and records the
deploy on the board. A machine it can't reach is skipped and catches up the next time its
Herdr window opens or comes forward. `scripts/deploy --local` deploys to this machine only.

## 10. Open it (each machine)

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

## 11. Nightly cleanup (optional, one machine)

Finished tasks clean up their own worktree once merged. A nightly sweep also catches what
was left behind, on every machine, and shows the result in the sidebar footer. Add it to
one machine's crontab (`crontab -e`):

```cron
30 3 * * * $HOME/git/herdr-projects/scripts/nightly-cleanup >> $HOME/.cache/herdr-projects/nightly-cleanup.log 2>&1
```

With the full Pi service ([docs/pi.md](docs/pi.md)) the box runs it instead.
`scripts/cleanup` (a dry run) lists the same things by hand.

## More on the box

With the board on their own box, [docs/pi.md](docs/pi.md) adds phone alerts, a web page to
answer agents from a phone, approvals for Claude Code's permission prompts, a nightly
backup, an end-of-day digest and a standby copy of the board.

## Adding a machine later

On the new machine do steps 1–4, add it to `machines` and `hosts` in the config, copy the
config to every machine, run step 7 on every machine, then `scripts/deploy` from any one.

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
`~/.config/herdr-board`. Drop the board's database where it lives.

## When something is off

- `scripts/doctor` first.
- `herdr-app status` shows the window's errors; `~/.config/herdr-app/*.error` shows files
  Herdr refused.
- Logs are in `~/.cache/herdr-projects/`.
- A run doesn't start anything: the window of the run's machine must be open on
  `projects-dracula`.
- `Board config missing` in the sidebar: step 5 on that machine.
