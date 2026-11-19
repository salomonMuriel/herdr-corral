# Where the board lives

The board is one Postgres database (14 or newer) that every machine shares. Any Postgres
works. Clients reach it over HTTP in Neon's `/sql` format, because the Herdr mod can make
HTTP requests but can't open a database connection. Neon answers that format itself. Any
other Postgres gets `herdr-sql`, a small gateway in this repo, in front of it.

Each option ends with the same two values in `~/.config/herdr-board/config.json`:

```json
"board": {
  "host": "<where /sql answers>",
  "url": "postgresql://<user>:<password>@<host>:<port>/<database>"
}
```

`url` is the database's connection string. `scripts/migrate` connects to it directly, and
clients send it to the gateway, which checks its password. `host` is a bare host
(`https://<host>/sql`) or a full base URL (`http://127.0.0.1:8097`).

| Option | Runs on | Gateway | Good for |
| --- | --- | --- | --- |
| 1. Your own box (recommended) | Pi, NAS, home server, VPS on your tailnet | included | keeping the board on your tailnet at no cost; the same box can run alerts and the web page |
| 2. Neon | Neon's cloud | not needed | nothing to run; free plan is enough |
| 3. Supabase | Supabase's cloud | `scripts/deploy-gateway` | if you already use Supabase |
| 4. Any other Postgres | RDS, Railway, Render, your own server | `scripts/deploy-gateway` | if you already run Postgres |

The gateway has to be up for the board to work, so run it on a machine that is always on.

## 1. Your own box (recommended)

The maintainers run Postgres 18 and the gateway in Docker on a Raspberry Pi, reached over
Tailscale. Any always-on Linux box with Docker on your tailnet works, including one of
your own machines if it never sleeps.

**(person)** Once, on the box: install Docker (with the compose plugin) and Tailscale, join
the tailnet, and enable Tailscale SSH (`sudo tailscale up --ssh`). In the Tailscale admin
console, turn on MagicDNS and HTTPS certificates (DNS page).

On your machine, add the box to the config:

```json
"pi": { "ssh": "you@pi", "host": "pi.your-tailnet.ts.net", "dir": "herdr-pi" }
```

`host` is the box's MagicDNS name (`tailscale status` lists it). Then:

```sh
cd ~/git/herdr-projects && scripts/deploy-pi --board-only --set-board
```

It starts `herdr-db` and `herdr-sql` in `~/herdr-pi` on the box, generates the database
passwords, publishes the gateway (`:8097`) and Postgres (`:5440`) on the tailnet only with
`tailscale serve`, and writes the `board` block into this machine's config. It reads the
password over SSH and never prints it.

Later, [docs/pi.md](pi.md) adds phone alerts, the web page, backups and a standby on the
same box.

## 2. Neon

**(person)** Sign up at [neon.tech](https://neon.tech), then create a project, either in
the console or with `neonctl` (`npm i -g neonctl`, `neonctl auth`):

```sh
neonctl projects create --name herdr-board --output json
neonctl connection-string --project-id <project id>
```

Use the direct connection string, not the `-pooler` one:

```json
"board": {
  "host": "ep-cool-name-123456.us-east-2.aws.neon.tech",
  "url": "postgresql://neondb_owner:<password>@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
}
```

`host` is only the host part of the string. Neon answers `/sql` itself, so there's nothing
to run.

## 3. Supabase

**(person)** Create a project at [supabase.com](https://supabase.com). Under Connect, copy
the Session pooler connection string (the direct one is IPv6-only on most plans):

```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Put it in `board.url` (any `host` for now), then run the gateway on an always-on machine
with Docker:

```sh
cd ~/git/herdr-projects && scripts/deploy-gateway
```

It writes `board.host` for you.

Supabase serves the `public` schema through its Data API to anyone holding the project's
anon key. After `scripts/migrate` (INSTALL.md step 8), turn on row-level security on the
board's tables, which blocks that API while the gateway, connecting as the tables' owner,
keeps full access:

```sh
psql "$(python3 scripts/herdr_config.py get board.url)" -f examples/supabase-rls.sql
```

Run it again after a migration adds tables.

## 4. Any other Postgres

Put its connection string in `board.url` and run `scripts/deploy-gateway` on an always-on
machine with Docker that can reach it, as for Supabase. Add `?sslmode=require` when the
server is on the internet.

`deploy-gateway` runs the gateway in Docker under `~/herdr-gateway`. With Tailscale on that
machine it publishes it on the tailnet at `https://<machine>.<tailnet>.ts.net:8097`; without
Tailscale, only that machine reaches it (`http://127.0.0.1:8097`), which suits a
single-machine setup. A Postgres on the gateway's own machine must accept connections from
Docker, not only from `127.0.0.1`; use `host.docker.internal` as its host in `board.url`.
`HERDR_GATEWAY_PORT` picks another port.

## Moving the board

`pg_dump` the old database and `pg_restore --no-owner` into the new one, then point `board`
at it on every machine.
