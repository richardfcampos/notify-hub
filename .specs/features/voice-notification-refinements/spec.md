# Voice Notification Refinements Specification

## Problem Statement

Two issues found live using the voice channels: (1) spoken notifications read the FULL rich payload (Início/Fim/duração/headline) meant for visual channels, which is tedious to listen to — the user wants just the project name and that it finished; (2) two tasks finishing at nearly the same time triggered two overlapping `say` calls on the local player, talking over each other.

## Goals

- [ ] Voice channels (`local-tts`, `voicemonkey`) speak a short summary derived from the notification's `title` only, never the full `message` body.
- [ ] The local TTS player speaks one announcement at a time — concurrent `/speak` requests queue and play sequentially, never overlapping.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Changing what the hook sends to notify-hub | The rich title+message payload stays correct/useful for visual channels (ntfy, Telegram, Discord, Slack); only the voice channels change how they consume it |
| Voice Monkey playback queuing | Voice Monkey is a third-party service — no ownership of playback order on the actual Echo device; queuing only applies to the local player, which this project fully controls |
| Cross-process queue (e.g. across multiple worker containers) | The player is a single host process; an in-process queue is sufficient — there is only ever one player instance |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Summary source | `notification.title` verbatim, with emoji/leading symbols stripped (leading run of non-letter/digit characters + following whitespace) | The hook already formats title as `<emoji> <project> — <status>` (e.g. `✅ notify-hub — concluído`) — stripping the emoji and speaking the rest already satisfies "project name + that it finished" with zero new fields | n (agent default) |
| No title present | Fall back to speaking `message` as today (unchanged) | Never silently drop a notification that has no title | y (safety net) |
| `—` em-dash in title | Left as-is (spoken naturally as a pause-ish word by TTS engines, acceptable) | Simplicity — not worth a special-case for one character | n (agent default) |
| Queue scope | `local-tts-player` only, one in-process FIFO queue per server instance | Voice Monkey is out of scope (see above); the player is the only piece we can queue | y |
| HTTP response timing | Unchanged — `POST /speak` still returns `202` immediately (fire-and-forget contract, LTTS-01 AC3); queuing is purely internal to when the underlying `say` process actually runs | y (must not regress the existing async contract) |
| Queue failure isolation | One item's `say` failure (non-zero exit) must not block subsequent queued items | y |

**Open questions:** none.

## User Stories

### P1: Brief spoken summary ⭐ MVP
**Acceptance Criteria**:
1. WHEN a notification has a `title` THEN `local-tts` and `voicemonkey` SHALL speak the title with any leading emoji/symbol run (and the whitespace after it) stripped, and SHALL NOT include `message` in the spoken text.
2. WHEN a notification has NO `title` THEN the channel SHALL fall back to speaking `message` (unchanged behavior).
3. Visual channels (ntfy, Telegram, Slack, Discord, email, webhook) are UNCHANGED — they keep receiving/showing the full title+message.

### P1: Sequential local playback ⭐ MVP
1. WHEN two `/speak` requests arrive on the local-tts-player close together THEN the second's `say` invocation SHALL NOT start until the first's has completed (exited), so their audio never overlaps.
2. WHEN a queued item's `say` invocation fails THEN subsequent queued items SHALL still play (failure isolation).
3. `POST /speak`'s HTTP response SHALL remain immediate (`202`) regardless of queue depth — the caller is never made to wait for its turn to actually play.

## Edge Cases
- Three or more notifications arriving in rapid succession all queue and play in arrival order, none dropped.
- A title that is ONLY emoji/symbols (no letters left after stripping) → speak the stripped (possibly near-empty) remainder rather than erroring; this is a theoretical edge, not expected in practice given the hook's own title format.

## Requirement Traceability
| ID | Story | Status |
| -- | ----- | ------ |
| VNR-01 | Brief spoken summary (local-tts + voicemonkey) | Pending |
| VNR-02 | Sequential playback queue (local-tts-player) | Pending |

## Success Criteria
- [ ] Live: a real hook-triggered notification is spoken as roughly "notify-hub, concluído" (or similar, stripped of emoji), not the full duration/headline text.
- [ ] Live: two notifications sent back-to-back to the local-tts channel play one after the other audibly, not overlapping.
- [ ] Unit tests cover the stripping logic and the queue's sequential-ordering + failure-isolation behavior (fake execFile, no real Mac/`say` needed).
