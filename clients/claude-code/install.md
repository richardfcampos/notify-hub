# Claude Code Notification Hook -- Install Guide

Pushes a notification to your phone/desktop (via notify-hub) whenever Claude
Code starts a task, finishes a task, or needs your input -- globally, across
every project.

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

## 4. Configure the hook

Two ways to supply `NOTIFY_URL`/`NOTIFY_TOKEN`/toggles -- pick one (or mix):

### Option A -- config file (recommended, zero shell-profile setup)

Create `~/.config/notify-hub/hook.env` (`chmod 600` it -- it holds a bearer
token) as a simple `KEY=VALUE` file:

```bash
mkdir -p ~/.config/notify-hub
cat > ~/.config/notify-hub/hook.env <<'EOF'
NOTIFY_URL=http://localhost:8080/notify
NOTIFY_TOKEN=supersecrettoken
NOTIFY_ON_START=false
NOTIFY_ON_END=true
NOTIFY_ON_NEEDS_INPUT=true
NOTIFY_IDLE_SECONDS=180
EOF
chmod 600 ~/.config/notify-hub/hook.env
```

The hook reads this file automatically -- no shell restart, no `~/.zshrc`
edit, works the same across every project. Point it at a different file
with `NOTIFY_HOOK_CONFIG=/path/to/hook.env`. Blank lines and `#` comments
are ignored; a malformed line is skipped rather than breaking the rest of
the file.

### Option B -- environment variables (still supported, takes precedence)

The hook also reads `process.env` directly, so exporting these in your
shell profile (`~/.zshrc`, `~/.bashrc`) still works -- and **wins over the
config file** for any variable it sets. See
[`.env.example`](./.env.example) in this folder for the full list:

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `NOTIFY_URL` | yes (unless in config file) | Full URL to the gateway's `/notify` endpoint, e.g. `http://localhost:8080/notify` |
| `NOTIFY_TOKEN` | yes (unless in config file) | Bearer token configured in the gateway's `TOKENS` env var |
| `NOTIFY_ON_START` | no (default **off**) | Set to `true` to also get a push when a task starts; the start time is always cached for duration regardless |
| `NOTIFY_ON_END` | no (default on) | Set to `false` to silence the task-end push |
| `NOTIFY_ON_NEEDS_INPUT` | no (default on) | Set to `false` to silence the needs-input push |
| `NOTIFY_IDLE_SECONDS` | no (default **180**) | How long an "end" push waits, quiet, before actually sending -- see [Idle debounce](#idle-debounce-quiet-window-for-the-end-push) below. `0` restores the old immediate-send behavior |
| `NOTIFY_HOOK_CONFIG` | no | Overrides the config-file path (default `~/.config/notify-hub/hook.env`) |

Example (`~/.zshrc`):

```bash
export NOTIFY_URL="http://localhost:8080/notify"
export NOTIFY_TOKEN="supersecrettoken"
export NOTIFY_ON_END=true
export NOTIFY_ON_NEEDS_INPUT=true
export NOTIFY_IDLE_SECONDS=180
```

Open a new terminal (or `source ~/.zshrc`) so Claude Code inherits the vars.

### Idle debounce (quiet window for the "end" push)

Claude Code's `Stop` hook fires at the end of **every** assistant turn --
including plain conversational replies, not just when a whole task wraps
up. Sending a push on every one of those (especially across several
parallel sessions) is a flood, not a signal.

So the "end" push is debounced instead of sent immediately: on `Stop`, the
hook saves the computed push and waits `NOTIFY_IDLE_SECONDS` (default
**180**) of *quiet* -- no new prompt in that same session -- before it
actually sends. Two things can happen during that window:

- **You send another prompt** -- the held push is cancelled outright.
  You're clearly still there; no notification needed. If Claude then stops
  again later, that later `Stop` starts its own fresh window.
- **A later `Stop` in the same session fires first** (e.g. one more
  conversational back-and-forth before you step away) -- it replaces the
  held push with the newest one and restarts the window; only one push
  ever ends up sending per quiet period.

If you close the terminal or the machine sleeps through the window, the
push simply sends whenever the window elapses (or is silently lost if the
process never gets to run again) -- either way it never blocks or delays
Claude Code itself, since the wait happens in a separate, detached
process, not in the `Stop` hook invocation itself.

Set `NOTIFY_IDLE_SECONDS=0` to turn debouncing off and go back to a push
on every single `Stop`. The needs-input push (`Notification` event) is
**never** debounced -- a permission prompt always needs you right away.

## 5. Try it

Run any Claude Code task in any project. By default, once the session goes
quiet for `NOTIFY_IDLE_SECONDS` (180s) you'll get one "end" push
(`✅ <project> — concluído` or `🤔 <project> — aguardando sua decisão` if
Claude's last message ends in a question) with start/end time, duration
and a headline, and a "needs-input" push (`🙋 <project> — precisa de você`)
immediately if Claude stops to ask for permission. Set
`NOTIFY_ON_START=true` if you also want a push the moment you submit a
prompt.

## Troubleshooting

- **No pushes at all**: confirm `NOTIFY_URL`/`NOTIFY_TOKEN` are set, either
  as env vars in the shell Claude Code actually runs in (`echo $NOTIFY_URL`
  in that same terminal) or in `~/.config/notify-hub/hook.env`. Confirm the
  gateway is up: `curl $NOTIFY_URL/../health` (i.e.
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
- **"end" push is missing a duration**: the task start time is cached (in
  `$TMPDIR`, keyed by session id) on every prompt submit regardless of
  `NOTIFY_ON_START`, and read back at "end". If the session ID differs
  between the two hook calls, the duration is simply omitted -- never
  blocks the send.
- **Project name looks wrong in a worktree**: the hook resolves the
  *main* repository's name (via `git rev-parse --git-common-dir`), not the
  worktree directory's own name, so every worktree of a project reports
  under the same project name.
- **"end" push takes a few minutes to arrive / never arrives**: by design
  (see [Idle debounce](#idle-debounce-quiet-window-for-the-end-push)) --
  it waits out `NOTIFY_IDLE_SECONDS` (180s by default) of quiet before
  sending, and is cancelled entirely if you send another prompt first. Set
  `NOTIFY_IDLE_SECONDS=0` if you want the old immediate-on-every-`Stop`
  behavior back instead.
- **One project not toggled the way you want**: config is resolved fresh
  on every hook call (env, then the config file), so a project-local
  `.claude/settings.json` + shell env override (e.g. a per-repo
  `direnv`/`.envrc`) lets you tune toggles per project.
