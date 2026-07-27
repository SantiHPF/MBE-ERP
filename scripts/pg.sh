#!/usr/bin/env bash
# Local Postgres control for development.
#
# There is no Docker on this machine, and the system-wide Postgres 17 install
# needs sudo to start. So development uses a cluster owned by the current user,
# created inside the repo at .pgdata (gitignored) and listening on 5433 so it
# never collides with a system Postgres on 5432.
#
# The systems team will not use this script -- see README for deployment.

set -euo pipefail

PGBIN="${PGBIN:-/Library/PostgreSQL/17/bin}"
PGDATA="$(cd "$(dirname "$0")/.." && pwd)/.pgdata"
PGPORT="${PGPORT:-5433}"
DBNAME="${DBNAME:-task_erp}"

if [ ! -x "$PGBIN/pg_ctl" ]; then
  echo "Postgres binaries not found at $PGBIN" >&2
  echo "Set PGBIN to your Postgres 17 bin directory and retry." >&2
  exit 1
fi

case "${1:-}" in
  init)
    if [ -d "$PGDATA" ]; then
      echo "Cluster already exists at $PGDATA"
      exit 0
    fi
    "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust
    ;;
  start)
    if [ ! -d "$PGDATA" ]; then
      "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust
    fi
    if "$PGBIN/pg_isready" -h localhost -p "$PGPORT" >/dev/null 2>&1; then
      echo "Server already running on port $PGPORT"
    else
      "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" -o "-p $PGPORT" start
      sleep 1
    fi
    "$PGBIN/createdb" -h localhost -p "$PGPORT" -U postgres "$DBNAME" 2>/dev/null \
      && echo "Created database $DBNAME" \
      || echo "Database $DBNAME already exists"
    ;;
  stop)
    "$PGBIN/pg_ctl" -D "$PGDATA" stop
    ;;
  status)
    "$PGBIN/pg_isready" -h localhost -p "$PGPORT"
    ;;
  psql)
    shift
    "$PGBIN/psql" -h localhost -p "$PGPORT" -U postgres -d "$DBNAME" "$@"
    ;;
  *)
    echo "usage: scripts/pg.sh {init|start|stop|status|psql}" >&2
    exit 1
    ;;
esac
