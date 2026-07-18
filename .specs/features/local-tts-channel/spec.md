# Local TTS (macOS `say`) Channel Specification

## Problem Statement

Alexa integration (official API and third-party bridges) all carry cost, request quotas, or unofficial-API account risk (researched and documented in `.specs/features/voicemonkey-channel/`). The user's own Mac already has a high-quality, free, offline TTS engine (`say`) with Portuguese voices installed. A local, host-level "TTS player" service can speak notifications out loud through the Mac's own speakers, with zero cost, zero quota, zero Amazon dependency — and the admin panel should let the user pick the voice from a live dropdown instead of typing an error-prone voice name (macOS has many same-named voices across languages, e.g. 14 different "Grandma" voices, one per locale).

## Goals

- [ ] A new channel type `local-tts` speaks the notification's message aloud through a speaker attached to a host machine, via a small companion HTTP service running OUTSIDE Docker (Docker Desktop on Mac cannot access host CoreAudio from inside a container).
- [ ] The admin panel's channel config form renders the voice field as a dropdown of ACTUALLY installed voices (fetched live from the player), not free text — eliminating the disambiguation problem discovered live (`say -v Grandma` silently resolved to English).
- [ ] Zero new cost, zero request quota, zero Amazon/third-party account dependency.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Piper TTS / neural voices | User confirmed macOS `say` quality is sufficient; avoids binary/model download entirely |
| Cross-platform player (Linux/Windows TTS) | Target host is this Mac; `say` is macOS-only. A future contributor could add a Linux backend behind the same `/speak` HTTP contract |
| A fully generic "dynamic dropdown field" framework in the admin UI | Only `local-tts` needs this; a hardcoded special case is simpler and matches the project's existing pattern of small, explicit UI logic (YAGNI) |
| Auth on the player service | Bound to loopback only; same trust model as every other localhost-bound piece of this stack |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Player location | `clients/local-tts-player/` in this repo (same convention as `clients/claude-code/`, `clients/mcp/`) — a standalone Node.js process run directly on the host (launchd on macOS), NOT in Docker | Docker Desktop for Mac has no CoreAudio access from inside containers | y (architecture constraint, verified via known Docker Desktop for Mac limitation) |
| Player → notify-hub reachability | notify-hub's worker container reaches the player via `http://host.docker.internal:<port>` (Docker Desktop for Mac routes this to the host, including loopback-bound services) | Standard Docker Desktop for Mac mechanism | n (worker verifies live in smoke test) |
| Player security | Binds `127.0.0.1` only, no auth token | Same trust posture as the pre-Amendment-1 admin panel; only reachable from this host + Docker's host-gateway routing | n (agent default) |
| Voice selection default | `Luciana` (pt_BR, unambiguous name — confirmed live) | Verified live in this session | y |
| Command execution | `child_process.execFile` (array args, never string-interpolated shell) for both `say -v '?'` (list) and `say -v <voice> <text>` (speak) | Prevents command injection via arbitrary notification text | y (security requirement) |
| Voices list format | `GET /voices` parses `say -v '?'` output into `[{ name, locale, sample }]`, using the EXACT string macOS prints (e.g. `Grandma (Portuguese (Brazil))`) as the value sent back for `-v`, so ambiguous names are pre-disambiguated by construction | Directly solves the discovered bug | y |
| Admin UI mechanism | Hardcoded special case for `type === 'local-tts'` in `admin-channels.js`: the voice field renders as `<select>`, populated via an admin-backend proxy route `GET /api/local-tts/voices?url=<player-url>` (avoids browser CORS/mixed-content issues by proxying server-side) | Simplest correct thing (YAGNI) | n (agent default) |
| Fallback when player unreachable | Voice field falls back to a plain text input (keeps the form usable even before the player is running) | Never block config editing on a live dependency | y |

**Open questions:** none — resolved above.

## User Stories

### P1: Local TTS player service ⭐ MVP
**Acceptance Criteria**:
1. WHEN the player starts THEN it SHALL bind `127.0.0.1` only.
2. WHEN `GET /voices` is called THEN it SHALL return every installed voice as `{name, locale, sample}`, with `name` being the exact string required by `say -v`.
3. WHEN `POST /speak {voice, text}` is called with a known voice THEN it SHALL invoke `say` via `execFile` (array args) with that exact voice string and the text, and respond after invocation completes (or fire-and-forget with immediate 202 — worker's choice, documented).
4. WHEN `text` contains shell metacharacters or quotes THEN it SHALL be passed safely with no injection risk (proven by a test).
5. WHEN the requested voice is unknown/empty THEN it SHALL fall back to the configured default voice rather than erroring loudly.

### P1: `local-tts` channel adapter ⭐ MVP
1. WHEN a `local-tts` instance is enabled and configured with a player URL + voice THEN sending a notification SHALL POST `{voice, text: "<title>. <message>"}` to `<url>/speak`.
2. WHEN the player is unreachable or errors THEN the adapter SHALL throw (same retry/isolation semantics as every other channel).
3. Registry entry declares `requiredConfig: ['LOCAL_TTS_URL', 'LOCAL_TTS_VOICE']`.

### P1: Voice dropdown in the admin panel ⭐ MVP
1. WHEN the operator is configuring a `local-tts` instance THEN the `LOCAL_TTS_VOICE` field SHALL render as a `<select>` populated from the player's live voice list (fetched via the admin backend proxy).
2. WHEN the player is unreachable THEN the field SHALL fall back to a plain text input pre-filled with any existing value, without blocking the rest of the form.

## Edge Cases
- Player process crashes → adapter throws (channel isolated, others unaffected), no crash to notify-hub itself.
- Very long message → `say` handles arbitrary length; no artificial truncation needed (no channel-imposed `maxLength`).
- Player restarts (e.g. Mac reboot) → must auto-start (launchd `RunAtLoad`), documented in install steps.

## Requirement Traceability
| ID | Story | Status |
| -- | ----- | ------ |
| LTTS-01 | Player service (`/voices`, `/speak`, safe execFile, loopback-only) | Pending |
| LTTS-02 | `local-tts` channel adapter + registry | Pending |
| LTTS-03 | Admin panel voice dropdown (proxy route + UI special case + fallback) | Pending |
| LTTS-04 | launchd auto-start + docs + live smoke (real audio out loud) | Pending |

## Success Criteria
- [ ] Live: add a `local-tts` instance in the panel (voice picked from real dropdown), Send test → the Mac's speakers actually speak the message.
- [ ] Player unit-tested with mocked `execFile` (no dependency on a real Mac to run the test suite in CI); adapter unit-tested with `FakeHttpClient`.
- [ ] Player restarts automatically on login/reboot via launchd.

---

## Amendment 2 — Searchable voice combobox (2026-07-18)

User feedback (verbatim): "use meio que algo parecido com um select2, ta feio esse dropdown Local Tts Voice e com um ux horrivel". A native `<select>` with ~180 unsorted-by-relevance voices (many near-duplicate names across locales, e.g. 14 "Grandma"s) is genuinely painful — no way to filter by typing "portu" to jump to Portuguese voices.

### LTTS-05: Searchable voice combobox ⭐
1. WHEN the operator clicks/focuses the `LOCAL_TTS_VOICE` field THEN a text input SHALL appear with a dropdown panel of matching voices below it, instead of a native `<select>`.
2. WHEN the operator types THEN the panel SHALL filter to voices whose name, locale, or sample text contains the typed substring (case-insensitive), live as they type.
3. WHEN the operator clicks or keyboard-selects (arrow keys + Enter) an option THEN that voice's exact `name` SHALL become the field's value (same underlying contract as before — no change to what's sent to the adapter).
4. WHEN Escape is pressed or the operator clicks outside THEN the panel SHALL close without changing the value.
5. **No new dependency** — built as plain HTML/CSS/JS matching the existing admin UI's zero-dependency, no-CDN convention (explicitly NOT jQuery/Select2 itself).
6. The player-unreachable text-input fallback (LTTS-03 AC2) is unchanged.

| ID | Story | Status |
| -- | ----- | ------ |
| LTTS-05 | Searchable voice combobox (no new dependency) | Pending |
