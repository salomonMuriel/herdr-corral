# The Pi service

Optional, after [INSTALL.md](../INSTALL.md). It runs on the always-on box that holds the
board in the recommended setup ([docs/database.md](database.md), option 1), or on any other
Linux box with Docker on your tailnet while the board lives elsewhere. It adds:

- phone alerts through a self-hosted [ntfy](https://ntfy.sh) when an agent is blocked or
  finishes while you're away,
- a web page on the tailnet to read and answer agents from a phone, and to approve Claude
  Code's permission prompts,
- the nightly cleanup (replacing the cron line from INSTALL.md step 11), a nightly backup of
  the board when it lives on the box, and an end-of-day digest in the Today view,
- optionally, a standby copy of the board on one of your machines.

README.md, "Pi service", describes each part.

## Requirements

- The box set up as in [docs/database.md](database.md), option 1 (Docker, Tailscale with
  Tailscale SSH, MagicDNS and HTTPS certificates), and the `pi` block in the config.
- Every machine accepts SSH from the box without a password, since the service follows
  `hc events` on each one. Tailscale SSH does this on Linux; on macOS, add the box's public
  key to `~/.ssh/authorized_keys` (with Remote Login on).

## Set up

1. On the machine you deploy from:

   ```sh
   cp ~/git/herdr-projects/pi/config.example.toml ~/.config/herdr-board/pi.toml
   ```

   Set `web_logins` to the person's Tailscale login, list every machine with the same names
   as the config and how the box reaches it, and put the box's MagicDNS name in the URLs.

2. Deploy the whole service (the board's containers stay as they are):

   ```sh
   cd ~/git/herdr-projects && scripts/deploy-pi
   ```

   It adds `herdr-pi` and `herdr-ntfy`, publishes the web page (`:8096`) and ntfy (`:2586`)
   on the tailnet only with `tailscale serve`, and prints the web page's address.

3. **(person)** Phone alerts: install the ntfy app, add the server `https://<pi host>:2586`
   and subscribe to `herdr`. `curl -X POST http://127.0.0.1:8095/alerts/test` on the box
   sends a test.

4. Remove the nightly cleanup cron line if you added one; the box runs it now.

## A standby (optional)

With the board on the box, one of your machines with Docker can keep a streaming copy. Add
the `standby` block from `examples/config.pi.example.json` (`host` is that machine's
MagicDNS name, `dir` where its data lives) and run `scripts/deploy-standby` on that machine.
When the box dies, `scripts/board-failover` there promotes the copy and points every
machine at it. README.md, "Board database", has the way back.
