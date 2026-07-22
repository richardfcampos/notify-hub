# Local TTS Player -- Install Guide

Runs a tiny HTTP service directly on this Mac (outside Docker) that speaks
notify-hub notifications out loud via macOS's built-in `say` command --
free, offline, no third-party account. See
[`../../.specs/features/local-tts-channel/spec.md`](../../.specs/features/local-tts-channel/spec.md)
for the full design; this doc only covers running/installing it.

## Why it can't run in Docker

Docker Desktop for Mac gives containers no access to the host's CoreAudio
subsystem, so `say` inside a container produces no sound at all. This
player has to run as a normal host process. notify-hub's `worker` container
(inside Docker) reaches it over `http://host.docker.internal:8082` -- Docker
Desktop for Mac routes that hostname to the host, including loopback-bound
services like this one.

## Fast path -- just run it in a terminal (no launchd)

Good enough for local dev/testing; stops when the terminal closes or the
Mac sleeps/reboots:

```bash
cd /path/to/notify-hub
node clients/local-tts-player/local-tts-server.mjs
# => local-tts-player: listening on http://127.0.0.1:8082
```

Verify it's serving real voices:

```bash
curl -s 127.0.0.1:8082/voices | head -c 300
```

Override the port or default voice with env vars:

```bash
PORT=8090 DEFAULT_VOICE=Joana node clients/local-tts-player/local-tts-server.mjs
```

## Persistent path -- launchd (auto-starts on login/reboot)

1. Find the absolute path to this repo's clone:

   ```bash
   cd /path/to/notify-hub
   realpath clients/local-tts-player/local-tts-server.mjs
   # e.g. /Users/you/code/notify-hub/clients/local-tts-player/local-tts-server.mjs
   ```

2. Copy the plist into your LaunchAgents directory:

   ```bash
   cp clients/local-tts-player/com.notify-hub.local-tts-player.plist \
     ~/Library/LaunchAgents/com.notify-hub.local-tts-player.plist
   ```

3. **Edit the copy** (`~/Library/LaunchAgents/com.notify-hub.local-tts-player.plist`)
   and replace both `/ABSOLUTE/PATH/TO/notify-hub` placeholders (the
   `ProgramArguments` script path and `WorkingDirectory`) with the real path
   from step 1's `realpath` output (the repo root, not the file itself, for
   `WorkingDirectory`). Also confirm the `node` path in `ProgramArguments`
   matches `which node` on this machine -- `/usr/local/bin/node` is the
   Intel-Homebrew default; Apple Silicon Homebrew installs use
   `/opt/homebrew/bin/node`, and `nvm` installs live under
   `~/.nvm/versions/node/<version>/bin/node` (launchd needs the literal
   resolved path here too, no `~`).

4. Load it:

   ```bash
   launchctl load ~/Library/LaunchAgents/com.notify-hub.local-tts-player.plist
   ```

5. Verify it's running and serving:

   ```bash
   launchctl list | grep notify-hub
   # => -    0    com.notify-hub.local-tts-player   (a "0" last-exit-status means running clean)
   curl -s 127.0.0.1:8082/voices | head -c 300
   ```

   If it's not listed or the curl fails, check the log:

   ```bash
   tail -50 ~/Library/Logs/notify-hub-local-tts-player.log
   ```

6. To stop it (e.g. before editing the plist again):

   ```bash
   launchctl unload ~/Library/LaunchAgents/com.notify-hub.local-tts-player.plist
   ```

   Re-run the `load` command from step 4 after any plist edit -- launchd
   does not pick up changes to an already-loaded plist automatically.

## Wire it into notify-hub -- what to put in `LOCAL_TTS_URL`

In the notify-hub admin panel (`http://127.0.0.1:8081`), add a channel
instance of type `local-tts`. The correct `LOCAL_TTS_URL` depends on WHERE
the player runs relative to WHERE notify-hub's `docker compose` stack runs:

| Player runs... | notify-hub (Docker) runs... | `LOCAL_TTS_URL` |
| --------------- | ---------------------------- | ---------------- |
| Same Mac, directly on the host (the supported/tested setup) | Same Mac, in Docker Desktop | `http://host.docker.internal:8082` -- Docker Desktop for Mac routes this hostname to the host, including loopback-bound services like this one. **Never use `127.0.0.1` here** -- from inside a container that means the container itself, not this Mac. |
| A different machine on your LAN/tailnet (e.g. speak through a Mac in another room) | Anywhere | **Not supported out of the box.** The player binds `127.0.0.1` only (`HOST` constant in `local-tts-server.mjs`) -- a deliberate trust boundary, since `/speak` has no auth and anyone who could reach it could make your speaker say arbitrary things. To use a remote speaker machine you'd need to change that bind to `0.0.0.0` yourself and accept that trade-off (matches this project's `ADMIN_BIND` pattern for the admin panel, but this player has no equivalent env override yet -- a source change, not a config one). |

`LOCAL_TTS_VOICE` -- pick from the live dropdown (populated from this
player's real `/voices` list once `LOCAL_TTS_URL` is filled in and the
player is reachable). If the player isn't reachable yet, the field falls
back to a plain text box -- type the EXACT name from `curl 127.0.0.1:8082/voices`
(voice names can collide across languages, e.g. 14 different "Grandma"
voices, one per locale -- the dropdown exists specifically to avoid typing
the wrong one).

Save, then "Send test" on that instance -- if the player is running, you'll
hear it speak through this Mac's speakers.

## Troubleshooting

**Pasting the install commands into a remote/SSH terminal fails with
`zsh: unknown file attribute: i` or similar.** This happens if you paste an
inline `#`-comment together with the commands (e.g. `# edit the plist ...
(see install.md)`) -- the parentheses inside a comment can confuse zsh over
SSH in some terminals. Run the comment-free commands one at a time instead;
don't paste explanatory comments as if they were shell input.

**`launchctl load`/`bootstrap` "works" but the service never actually
listens** -- `launchctl print gui/$(id -u)/com.notify-hub.local-tts-player`
shows `state = spawn scheduled` and `last exit code = 78: EX_CONFIG` (or
the process's own stderr shows a plain `Operation not permitted` when you
run the exact `ProgramArguments` command by hand), even though the exact
same `node ...` command run interactively in Terminal works fine.

**Root cause, confirmed** (previously undiagnosed in this doc): this is a
macOS TCC (privacy/permissions) restriction. A process spawned by
`launchd` does NOT inherit whatever "access this volume" permission your
interactive Terminal session already has, and is denied when it tries to
**read a script file located on a volume other than the boot disk** (e.g.
an external/Thunderbolt drive mounted at `/Volumes/...`, which is exactly
where this repo lives on the machine this was diagnosed on). It is not
about the `node` binary's location, the port, or the plist syntax --
those can all be perfectly correct and it still fails, because launchd
is denied permission to even *open* the target script.

**Fix**: keep the script `local-tts-server.mjs` itself OFF the external
volume. Copy it to somewhere on the boot disk and point the LaunchAgent's
`ProgramArguments` (and `WorkingDirectory`) at that copy instead -- the
script has no local imports (Node stdlib only), so a plain file copy is
safe and there is nothing else to keep in sync:

```bash
mkdir -p ~/.local-scripts
cp clients/local-tts-player/local-tts-server.mjs \
  ~/.local-scripts/notify-hub-local-tts-server.mjs
```

Then edit the plist's `ProgramArguments`' second string and
`WorkingDirectory` to point at `~/.local-scripts/...` instead of the
repo path, and reload:

```bash
launchctl bootout gui/$(id -u)/com.notify-hub.local-tts-player
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.notify-hub.local-tts-player.plist
launchctl kickstart -k gui/$(id -u)/com.notify-hub.local-tts-player
launchctl print gui/$(id -u)/com.notify-hub.local-tts-player | grep -E 'pid =|state ='
curl -s 127.0.0.1:8082/voices | head -c 200
```

If your repo already lives on the boot disk (no external volume
involved), you likely won't hit this at all -- the original `load`
instructions above should just work.

Other things confirmed to matter while diagnosing this:

- A stray manually-started process already holding the port
  (`lsof -i :8082`) makes any subsequent launchd attempt fail the same
  way -- always `kill` old manual instances before troubleshooting
  further.
- `KeepAlive: true` in the shipped plist does work correctly once the
  TCC issue above is fixed -- killing the process (`kill -9 <pid>`)
  gets it relaunched by launchd automatically within a couple of
  seconds, verified live.
