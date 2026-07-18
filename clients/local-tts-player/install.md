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

## Wire it into notify-hub

In the notify-hub admin panel (`http://127.0.0.1:8081`), add a channel
instance of type `local-tts`:

- `LOCAL_TTS_URL` = `http://host.docker.internal:8082` (from inside the
  `worker`/`api` containers -- NOT `127.0.0.1`, which would point at the
  container itself, not this Mac)
- `LOCAL_TTS_VOICE` = pick from the live dropdown (populated from this
  player's real `/voices` list once `LOCAL_TTS_URL` is filled in)

Save, then "Send test" on that instance -- if the player is running, you'll
hear it speak through this Mac's speakers.
