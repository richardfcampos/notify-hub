# Hook Status Payload Specification

## Problem Statement

The Claude Code hook sends a bare event + message excerpt. The user wants, across ALL projects, on task end and needs-me events: start AND end time, which project is being worked on, and a status classification — finished, awaiting a decision, or needs them — so the push alone tells them what's happening.

## Goals

- [ ] End notification carries: project name, start time, end time, duration, status emoji/label, and a headline from the assistant's last message.
- [ ] Needs-input notification carries: project name + what Claude is waiting for.
- [ ] Works with zero shell-profile setup: hook reads `~/.config/notify-hub/hook.env` (chmod 600) as fallback to env vars. User explicitly requested this persistence (2026-07-17: "quero que todos os projetos usem assim que terminar a tarefa ou precisar de mim").

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| LLM-based status classification | Heuristic on event + last message is enough; no extra cost/latency |
| Start push by default | User asked for end + needs-me events; start TIME is still recorded silently for duration |
| Windows support | User is macOS |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Status heuristic | event Notification → `🙋 precisa de você`; event Stop + last assistant message's final paragraph ends in `?` (or AskUserQuestion present) → `🤔 aguardando sua decisão`; else `✅ concluído` | Cheap, honest, multilingual-safe (punctuation-based) | n (agent default) |
| Start-time recording | ALWAYS cache session start on UserPromptSubmit (tmp file keyed by session_id), independent of NOTIFY_ON_START toggle | Decouples duration/em start time from the noisy start push | n (agent default) |
| Time formatting | Local time HH:MM (system TZ) + duration humanized (e.g. `12min`, `1h 04min`) | Push readability | n (agent default) |
| Project naming | git toplevel basename when inside a repo (worktrees resolve to the main repo name), else basename(cwd) | Worktree sessions should name the real project | n (agent default) |
| Config file | `~/.config/notify-hub/hook.env` (KEY=VALUE lines: NOTIFY_URL, NOTIFY_TOKEN, toggles), env vars take precedence | Avoids credentials in shell profile; user-authorized | y (user asked for zero-setup all-projects) |

**Open questions:** none.

## User Stories

### P1: Rich end notification ⭐ MVP
**Acceptance Criteria**:
1. WHEN Stop fires THEN the push title SHALL be `<emoji> <project> — <status label>` and the body SHALL include `Início HH:MM · Fim HH:MM (<duration>)` plus a 1-2 line headline from the last assistant message.
2. WHEN the last assistant message's final paragraph ends with `?` THEN status SHALL be `🤔 aguardando sua decisão`; otherwise `✅ concluído`.
3. WHEN start time is unavailable THEN the body SHALL include only the end time (never blocks the send).
4. WHEN the session runs in a git worktree THEN project SHALL be the main repository name.

### P1: Needs-input notification ⭐ MVP
1. WHEN the Notification hook fires THEN the push SHALL be `🙋 <project> — precisa de você` with the hook-provided message (e.g. permission request) in the body.

### P1: Config-file fallback ⭐ MVP
1. WHEN NOTIFY_URL/NOTIFY_TOKEN are absent from env THEN the hook SHALL read them from `~/.config/notify-hub/hook.env`; env vars win when both exist.
2. WHEN neither source has them THEN the hook SHALL exit 0 silently (unchanged contract: never blocks Claude).
3. Toggles (NOTIFY_ON_START/END/NEEDS_INPUT) SHALL be readable from the same file; start-time caching happens regardless of NOTIFY_ON_START.

## Edge Cases
- Transcript unreadable → send with generic headline (unchanged).
- Malformed config file line → ignored, rest parsed.
- Duration > 1h → `1h 04min` format; < 1min → `<1min`.

## Requirement Traceability
| ID | Story | Status |
| -- | ----- | ------ |
| HOOK-01 | Rich end payload (times/project/status/headline) | Done |
| HOOK-02 | Decision-vs-done heuristic | Done |
| HOOK-03 | Needs-input payload | Done |
| HOOK-04 | Config-file fallback + toggles + always-cache-start | Done |
| HOOK-05 | Git-toplevel project naming | Done |

## Success Criteria
- [ ] Live: finish a real task in any project → phone shows `✅ <project> — concluído` with Início/Fim/duração and headline; a permission prompt → `🙋` push.
- [ ] All behavior unit-tested (fake fetch/fs/transcript), zero-dep hook preserved, always exit 0.

---

## Amendment 1 — Idle debounce (2026-07-17)

User feedback (verbatim): "to sendo flodado de notificações, pq a cada coisa que o claude conclui ele manda uma, ele deveria so mandar quando realmente terminar tudo, n tiver fazendo nada ou precisar de mim". Root cause: `Stop` fires at the end of EVERY assistant turn (including conversational replies), and parallel sessions multiply it.

### HOOK-06: Idle-debounced end notification ⭐
1. WHEN Stop fires THEN the hook SHALL NOT send immediately: it SHALL persist the computed payload + stop timestamp and spawn a detached, unref'd deferred-sender for the same session that fires after `NOTIFY_IDLE_SECONDS` (default **180**, `0` = legacy immediate send).
2. WHEN a new UserPromptSubmit for the SAME session occurs before the deferred send fires THEN the pending notification SHALL be cancelled (deferred sender sees newer activity and exits silently — the user is present).
3. WHEN a NEWER Stop supersedes an older pending one (same session) THEN only the newest SHALL send (older deferred senders detect they are stale and exit); the sent payload reflects the LATEST turn, with Início = session start (unchanged).
4. WHEN the Notification (needs-input) event fires THEN it SHALL send IMMEDIATELY (never debounced).
5. The deferred sender SHALL inherit the always-exit-0/never-block contract and the same config resolution.

### Edge cases (Amendment 1)
- Deferred sender crashes/killed → no push (fail-silent), never blocks anything.
- Machine sleeps through the window → send on wake when the timer fires (acceptable).
- Debounce state lives in the same tmp dir as the start-cache, keyed by session_id.

| ID | Story | Status |
| -- | ----- | ------ |
| HOOK-06 | Idle-debounced end notification | Done |
