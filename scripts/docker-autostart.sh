#!/usr/bin/env bash
# Runs on login (via com.notify-hub.docker-autostart LaunchAgent) to bring
# the full stack back up after a reboot.
#
# Relying on docker-compose.yml's `restart: unless-stopped` alone proved
# unreliable in this environment: Docker Desktop on macOS runs its daemon
# inside a lightweight VM, and a hard restart of the Desktop app (e.g. after
# a reboot, or a forced quit) can leave previously-running containers in an
# `Exited (0)` state instead of auto-recovering them, even though the
# compose file's restart policy says they should come back. This script
# opens Docker Desktop, waits for the daemon to actually be reachable, then
# explicitly runs `docker compose up -d` -- deterministic, not dependent on
# Docker Desktop's own internal restart bookkeeping.

set -u

# launchd-spawned processes get a minimal PATH that doesn't necessarily
# include where the `docker` CLI lives (observed live: /usr/local/bin was
# NOT resolved in that context even though it's a normal, always-present
# directory in an interactive shell) -- prepend both common install
# locations explicitly rather than trusting inheritance.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

REPO_DIR="/Volumes/External Code/INTEL/Code/personal/notify-hub"
LOG="/tmp/notify-hub-docker-autostart.log"
MAX_WAIT_SECONDS=300

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

log "docker-autostart: starting"

open -a Docker

waited=0
while ! docker info >/dev/null 2>&1; do
  if [ "$waited" -ge "$MAX_WAIT_SECONDS" ]; then
    log "docker-autostart: gave up waiting for the Docker daemon after ${MAX_WAIT_SECONDS}s"
    exit 1
  fi
  sleep 3
  waited=$((waited + 3))
done
log "docker-autostart: daemon ready after ${waited}s"

cd "$REPO_DIR" || { log "docker-autostart: repo dir not found (external volume not mounted yet?)"; exit 1; }

# The external volume housing the repo can mount a few seconds after the
# daemon is reachable (it's on a different device than the boot disk) --
# retry the compose call a few times rather than failing on a transient
# "no such file or directory".
attempt=1
until docker compose up -d >> "$LOG" 2>&1; do
  if [ "$attempt" -ge 5 ]; then
    log "docker-autostart: docker compose up -d failed after ${attempt} attempts"
    exit 1
  fi
  log "docker-autostart: compose up attempt ${attempt} failed, retrying in 5s"
  attempt=$((attempt + 1))
  sleep 5
done

log "docker-autostart: stack is up"
