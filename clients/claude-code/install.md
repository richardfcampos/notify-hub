# Claude Code Notification Hook -- Install Guide

Pushes a notification to your phone/desktop (via notify-hub) whenever Claude
Code starts a task, finishes a task, or needs your input -- globally, across
every project (spec NOTIF-13).

## 1. Start the gateway first

The hook POSTs to a running notify-hub instance, so bring that up before
wiring the hook (see the root [`README.md`](../../README.md) quickstart):

```bash
cd /path/to/notify-hub
cp .env.example .env   # edit with your channel creds + a token
docker compose up -d
curl http://localhost:8080/health   # {"status":"ok","redis":true}
```

## 2. Find the absolute path to the hook script

```bash
cd /path/to/notify-hub
realpath clients/claude-code/notify-hook.mjs
# e.g. /Users/you/code/notify-hub/clients/claude-code/notify-hook.mjs
```

You'll paste this absolute path into the settings snippet below. It must be
the absolute path (not `~` or a relative path) because hooks run from
whatever directory Claude Code was launched in, which changes per project.

## 3. Wire the hook globally

Edit `~/.claude/settings.json` (create it if it doesn't exist) and add/merge
the `hooks` block below. Global (`~/.claude/settings.json`) hooks apply to
every project; use `.claude/settings.json` in a single repo instead if you
only want it there.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /abs/path/to/notify-hub/clients/claude-code/notify-hook.mjs"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /abs/path/to/notify-hub/clients/claude-code/notify-hook.mjs"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /abs/path/to/notify-hub/clients/claude-code/notify-hook.mjs"
          }
        ]
      }
    ]
  }
}
```

Replace `/abs/path/to/notify-hub/...` with the real absolute path from step 2
in **all three** places.

> `UserPromptSubmit` fires on `event=start`, `Stop` fires on `event=end`,
> `Notification` fires on `event=needs-input` (e.g. Claude is waiting on a
> permission prompt). Omit whichever entries you don't want pushes for.

## 4. Configure the hook's environment

The hook reads its config from `process.env`, so these variables must be set
in the shell Claude Code (and therefore the hook subprocess) runs in --
typically your shell profile (`~/.zshrc`, `~/.bashrc`) or a global `.env`
your shell sources on login. See
[`.env.example`](./.env.example) in this folder for the full list:

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `NOTIFY_URL` | yes | Full URL to the gateway's `/notify` endpoint, e.g. `http://localhost:8080/notify` |
| `NOTIFY_TOKEN` | yes | Bearer token configured in the gateway's `TOKENS` env var |
| `NOTIFY_ON_START` | no (default enabled) | Set to `false` to silence the task-start push |
| `NOTIFY_ON_END` | no (default enabled) | Set to `false` to silence the task-end push |
| `NOTIFY_ON_NEEDS_INPUT` | no (default enabled) | Set to `false` to silence the needs-input push |

Example (`~/.zshrc`):

```bash
export NOTIFY_URL="http://localhost:8080/notify"
export NOTIFY_TOKEN="supersecrettoken"
export NOTIFY_ON_START=true
export NOTIFY_ON_END=true
export NOTIFY_ON_NEEDS_INPUT=true
```

Open a new terminal (or `source ~/.zshrc`) so Claude Code inherits the vars.

## 5. Try it

Run any Claude Code task in any project. You should get a "start" push when
you submit a prompt, an "end" push naming the project when Claude finishes,
and a "needs-input" push if Claude stops to ask for permission.

## Troubleshooting

- **No pushes at all**: confirm `NOTIFY_URL`/`NOTIFY_TOKEN` are set in the
  shell Claude Code actually runs in (`echo $NOTIFY_URL` in that same
  terminal). Confirm the gateway is up: `curl $NOTIFY_URL/../health` (i.e.
  `http://localhost:8080/health`) should return `{"status":"ok","redis":true}`.
- **Hook never blocks/fails Claude, even when misconfigured** -- this is by
  design (spec NOTIF-13.4). The hook always exits `0`; on a network error,
  timeout, or non-2xx gateway response it logs a one-line message to
  **stderr** and moves on. Check Claude Code's hook output/logs for lines
  starting with `notify-hook:` to see what happened.
- **"end" push is missing a summary**: the summary is read best-effort from
  the session transcript; if the transcript is unreadable or has no
  assistant message yet, the push still sends with a generic message rather
  than failing.
- **"end" push is missing a duration**: duration is cached from the "start"
  push's timestamp (in `$TMPDIR`, keyed by session id) and read back at
  "end". If `NOTIFY_ON_START` was disabled or the session ID differs, the
  duration is simply omitted -- never blocks the send.
- **One project not toggled the way you want**: the env vars are read from
  the process environment at hook-invocation time, so a project-local
  `.claude/settings.json` + shell env override (e.g. a per-repo
  `direnv`/`.envrc`) lets you tune toggles per project.
