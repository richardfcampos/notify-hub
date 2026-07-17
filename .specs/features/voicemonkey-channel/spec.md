# Voice Monkey (Alexa) Channel Specification

## Problem Statement

The official Alexa Proactive Events API cannot deliver arbitrary spoken text automatically for a personal account (research: 8 fixed schemas, light/banner only, user must ask Alexa to hear it; verbatim-speech APIs either require an active voice session to create — Reminders API — or are enterprise-only — Smart Properties). Voice Monkey is a third-party service built specifically to trigger an Echo device to speak arbitrary text via a simple webhook, matching the CallMeBot pattern already used for WhatsApp.

## Goals

- [ ] A new channel type `voicemonkey` lets any channel instance announce the notification's message as spoken audio on a specific Echo device, via Voice Monkey's Announcement API.
- [ ] Fits the existing pluggable adapter model exactly (one `send()` method + a `ChannelRegistryEntry`); the admin panel and MCP config tools pick it up automatically (no core changes beyond the registry line).

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Voice Monkey account/device setup automation | Third-party account creation is the user's job |
| Two-way voice (asking Alexa to trigger sends) | User explicitly declined this direction |
| Official Amazon Proactive Events API | Confirmed insufficient (light/banner only, no verbatim speech) — documented here for future reference, not built |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| API contract | Verified against Voice Monkey's real, current API docs at implementation time (Knowledge Verification Chain — never fabricated) | Avoid building against a guessed contract | n (worker verifies) |
| Config keys | `VOICEMONKEY_TOKEN` (account token) + `VOICEMONKEY_DEVICE` (device/announcement name) — exact key names finalized against verified API | Matches ntfy/CallMeBot two-key pattern | n (worker confirms against real API) |
| Message length | Truncate like every other adapter (`TruncatingChannel`, `maxLength` in registry entry) if Voice Monkey documents a limit; otherwise no artificial cap | Consistent with existing adapters | n (worker verifies limit) |
| Error handling | Non-2xx or a Voice Monkey error body (if their API reports errors within a 2xx, à la CallMeBot) → throw, isolated per-instance like every channel | Consistent with the CallMeBot 2xx-lies-about-errors lesson already learned in this project | y |

**Open questions:** none — worker resolves the API-contract unknowns via real research before coding, per project convention (never fabricate an API).

## User Stories

### P1: Voice Monkey channel adapter ⭐ MVP
**Acceptance Criteria**:
1. WHEN a `voicemonkey` instance is enabled and configured with a valid token + device THEN sending a notification SHALL call Voice Monkey's Announcement endpoint with the notification's message as the spoken text.
2. WHEN Voice Monkey responds with an error (non-2xx, or a 2xx body indicating failure if their API does that) THEN the adapter SHALL throw (queue retry + per-instance isolation, unchanged from every other channel).
3. WHEN the message exceeds Voice Monkey's documented length limit (if any) THEN it SHALL be truncated rather than erroring.
4. The registry entry SHALL declare the exact required config keys the worker verifies against the real API.

## Edge Cases
- Missing token/device on an enabled instance → same write-time fail-fast as every other channel (config-validation.ts already generic over `requiredConfig`, no changes needed there).
- Special characters / accents in the message → must survive (same UTF-8 lesson as the ntfy fix — verify Voice Monkey's transport doesn't have the same header-vs-body pitfall).

## Requirement Traceability
| ID | Story | Status |
| -- | ----- | ------ |
| VM-01 | Voice Monkey adapter + registry entry | Pending |
| VM-02 | Docs (README channel table + setup steps) | Pending |

## Success Criteria
- [ ] Unit tests (happy + error path, FakeHttpClient) pass; adapter buildable via the existing type-keyed registry/build-instance path with zero core changes.
- [ ] Once the user creates a real Voice Monkey account, a real end-to-end announcement plays on their Echo (documented as a follow-up live-verification step — cannot be done by the agent, requires the user's own account).
