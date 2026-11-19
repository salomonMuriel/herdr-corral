#!/bin/bash
# Runs once, when the database is created. `tailscale serve --tcp` hands tailnet connections
# over from 127.0.0.1, which the image trusts, so every TCP login needs a password. The
# socket inside the container stays trusted for `docker exec … psql`. The standby copies
# this file with pg_basebackup.
set -euo pipefail

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v password="$REPLICATOR_PASSWORD" <<'SQL'
create role replicator with replication login password :'password';
SQL

cat > "$PGDATA/pg_hba.conf" <<'HBA'
local   all             all                     trust
local   replication     all                     trust
host    replication     replicator      all     scram-sha-256
host    all             all             all     scram-sha-256
HBA
