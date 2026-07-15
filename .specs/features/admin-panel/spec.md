# Admin Panel Specification

## Problem Statement

Configuring notify-hub means hand-editing `.env` and remembering to `docker compose up -d` — and misconfigurations (wrong Slack URL, dead CallMeBot key) were only caught by live debugging. A local web panel should make channels, credentials, and tokens visible (with reveal-able secrets), editable, testable per channel, and applied with one click.

## Goals

- [ ] `npm run admin` opens a dark dashboard at `http://127.0.0.1:8081` showing every channel, its credentials (masked, reveal on click), tokens/profiles, and gateway status.
- [ ] Editing + "Save & Apply" rewrites `.env` (validated, backed up) and restarts the stack — no terminal needed.
- [ ] "Send test" per channel proves delivery end-to-end and surfaces the real per-channel outcome (would have caught the Slack/WhatsApp misconfigs instantly).

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Remote/network access, HTTPS, auth | Binds 127.0.0.1 only (user decision); trust boundary = the machine |
| Multi-user / roles | Personal tool |
| Config in Redis / hot-reload | Keeps AD "config = env, fail-fast"; apply = compose restart |
| Preserving hand-written `.env` comments | Writer regenerates canonical format (backup kept); documented |
| Delivery history/analytics DB | Status shows recent worker-log tail only |
| React/build chain | Vanilla single-page (user decision) |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Placement | Host-side app, same repo (`src/admin/`), served by Fastify on 8081 | User selected; zero gateway changes | y |
| Access | 127.0.0.1 binding only, no password | User selected | y |
| Apply mechanism | `docker compose up -d` via injectable CommandRunner | Containers stay immutable; host owns lifecycle | n (agent default) |
| Test-send outcome | POST /notify + parse recent worker logs for that channel's result | Gateway has no /jobs endpoint (deferred P2); logs are authoritative | n (agent default) |
| `.env` writes | Canonical regeneration, atomic write, timestamped backup (like setup-env.sh) | Simple + safe; comments not preserved | n (agent default) |
| Secrets over the wire | Returned in full to the UI (masked client-side, reveal on click) | Localhost-only trust; "podendo mostrar as keys" is the ask | y |
| Admin port | 8081 (env-overridable `ADMIN_PORT`) | Gateway uses 8080 | n (agent default) |

**Open questions:** none — all resolved or logged above.

## User Stories

### P1: See and edit channel configuration ⭐ MVP

**User Story**: As the operator, I want every channel's enabled state and credentials visible and editable in one screen, so I stop hand-editing `.env`.

**Acceptance Criteria**:
1. WHEN the panel loads THEN it SHALL show one card per registered channel (ntfy, telegram, email, slack, discord, whatsapp, webhook) with its enabled toggle and its required config fields populated from `.env`.
2. WHEN a secret field renders THEN it SHALL be masked by default and reveal its value when the eye toggle is clicked (and re-mask on second click).
3. WHEN the operator edits values/toggles THEN the UI SHALL track unsaved changes and enable a "Save & Apply" action.
4. WHEN a channel is enabled but a required field is empty at save time THEN the save SHALL be rejected naming the channel + missing key (mirrors the gateway's fail-fast) and nothing SHALL be written.

**Independent Test**: Load panel with a known `.env` → cards match; toggle slack on with empty URL → save returns the named validation error; fill it → save succeeds.

### P1: Tokens / profiles management ⭐ MVP

**Acceptance Criteria**:
1. WHEN the panel loads THEN it SHALL list every profile from `TOKENS` (name, token masked + reveal, default channels).
2. WHEN the operator edits a profile (name, token, default channels) or adds/removes one THEN save SHALL rewrite the `TOKENS` line accordingly.
3. WHEN default channels reference a channel not in `CHANNELS_ENABLED` THEN save SHALL be rejected naming it.

### P1: Save & Apply pipeline ⭐ MVP

**Acceptance Criteria**:
1. WHEN "Save & Apply" is confirmed THEN the server SHALL validate, back up `.env` (timestamped), write the new canonical `.env` atomically, run `docker compose up -d`, and report each step's outcome to the UI.
2. WHEN validation fails THEN no file SHALL be touched and no restart SHALL run.
3. WHEN the compose apply fails THEN the UI SHALL show the command error output (the `.env` write remains, backup path shown).

### P1: Per-channel test send ⭐ MVP

**Acceptance Criteria**:
1. WHEN "Send test" is clicked on a channel THEN the server SHALL POST a test notification to the running gateway targeting only that channel, using the first profile's token.
2. WHEN the delivery outcome is available in worker logs THEN the UI SHALL show the real result: sent ✅, or the failure reason (e.g. CallMeBot body error) ❌.
3. WHEN the gateway is down THEN the test SHALL report that clearly instead of hanging.

### P1: System status ⭐ MVP

**Acceptance Criteria**:
1. WHEN the panel loads (and on refresh) THEN it SHALL show gateway health (`/health`), active channels (`/channels`), and the last ~20 worker delivery log lines (sent/failed per channel).
2. WHEN the gateway is unreachable THEN status SHALL show it as down without breaking the rest of the panel.

### P1: Localhost-only binding ⭐ MVP (security)

**Acceptance Criteria**:
1. WHEN the admin server starts THEN it SHALL listen on `127.0.0.1` only (asserted in tests); it SHALL never bind `0.0.0.0`.

## Edge Cases

- WHEN `.env` does not exist THEN the panel SHALL load with empty values and save SHALL create it.
- WHEN `.env` contains unknown/extra keys THEN they SHALL be preserved verbatim on rewrite (PORT, REDIS_URL, RETRY_*, custom).
- WHEN two saves race THEN the second SHALL operate on the latest file state (last-write-wins, single-user tool).
- WHEN the reveal toggle is used THEN no secret SHALL be logged by the admin server.

## Requirement Traceability

| Requirement ID | Story | Status |
| -------------- | ----- | ------ |
| ADMIN-01 | Localhost-only admin server + static UI | Pending |
| ADMIN-02 | GET config (channels/profiles from .env) | Pending |
| ADMIN-03 | Save: validation + backup + atomic write (incl. unknown-key preservation) | Pending |
| ADMIN-04 | Apply via docker compose (CommandRunner) | Pending |
| ADMIN-05 | Per-channel test send with real outcome | Pending |
| ADMIN-06 | Status (health, channels, recent deliveries) | Pending |
| ADMIN-07 | Dark dashboard UI (cards, toggles, masked secrets + reveal, save flow) | Pending |

## Success Criteria

- [ ] Full loop without terminal: open panel → fix a credential → Save & Apply → Send test → see ✅ on the phone and in the panel.
- [ ] All admin API behavior unit/e2e tested with fakes (FS, CommandRunner, gateway HTTP) — no Docker needed for the test suite.
