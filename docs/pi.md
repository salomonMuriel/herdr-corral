# Optional: the Pi

Do [INSTALL.md](../INSTALL.md) first; everything there works without this.

`herdr-pi` runs on any always-on Linux box with Docker on the same tailnet as your
machines (a Raspberry Pi, a NAS, a small VPS). It adds:

- phone alerts through a self-hosted [ntfy](https://ntfy.sh) when an agent is blocked or
  finishes while you're away,
- a web page on the tailnet to read and answer agents from a phone, and to approve Claude
  Code's permission prompts,
- the nightly cleanup (replacing the cron line from INSTALL.md step 10), a nightly board
  backup and an end-of-day digest in the Today view,
- optionally, the board itself in its own Postgres instead of Neon, with an optional
  standby on one of your machines.

README.md, "Pi service", describes each part.

## Requirements (person)

- Docker with the compose plugin, and Tailscale, on the box.
- In the Tailscale admin console: MagicDNS and HTTPS certificates turned on (DNS page).
- Every machine accepts SSH from the box without a password (Tailscale SSH), since the
  service follows `hc events` on each one.
- From the machine you deploy from: password-less SSH to the box.

## Set up

1. Add the `pi` block from `examples/config.pi.example.json` to
   `~/.config/herdr-board/config.json` on every machine:

   ```json
   "pi": { "ssh": "you@pi", "host": "pi.your-tailnet.ts.net", "dir": "herdr-pi" }
   ```

   `host` is the box's MagicDNS name, `dir` the folder under its home.

2. On the machine you deploy from:

   ```sh
   cp ~/git/herdr-projects/pi/config.example.toml ~/.config/herdr-board/pi.toml
   ```

   Set `web_logins` to the person's Tailscale login, list every machine with the same
   names as the config and how the box reaches it, and put the box's host in the URLs.

3. Deploy:

   ```sh
   cd ~/git/herdr-projects && scripts/deploy-pi
   ```

   It creates the database passwords the first time, starts `herdr-db`, `herdr-sql`,
   `herdr-pi` and `herdr-ntfy`, and publishes them on the tailnet only with
   `tailscale serve`. It prints the web page's address when it's up.

4. **(person)** Phone alerts: install the ntfy app, add the server `https://<pi host>:2586`
   and subscribe to `herdr`. `curl -X POST http://127.0.0.1:8095/alerts/test` on the box
   sends a test.

5. Remove the nightly cleanup cron line if you added one; the Pi runs it now.

## Moving the board to the Pi (optional)

A new, empty board:

1. Point `board` at the Pi in every machine's config. The password is
   `POSTGRES_PASSWORD` in `~/<pi.dir>/data/db.env` on the box:

   ```json
   "board": {
     "host": "pi.your-tailnet.ts.net:8097",
     "url": "postgresql://herdr:<POSTGRES_PASSWORD>@pi.your-tailnet.ts.net:5440/herdr"
   }
   ```

2. `scripts/migrate`, then `scripts/deploy-pi` again so the web page gets the new config.

To keep an existing Neon board's data, `pg_dump` it and `pg_restore --no-owner` into the
Pi's database before switching.

## A standby (optional)

With the board on the Pi, one machine with Docker can keep a streaming copy. Add the
`standby` block (`host` is that machine's MagicDNS name, `dir` where its data lives) and
run `scripts/deploy-standby` on that machine. When the box dies, `scripts/board-failover`
there promotes the copy and points every machine at it. README.md, "Board database", has
the way back.
