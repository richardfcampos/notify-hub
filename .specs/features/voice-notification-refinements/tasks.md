# Voice Notification Refinements — Tasks

**Spec**: `.specs/features/voice-notification-refinements/spec.md`
**Status**: Verifier PASS (`validation.md`), gap #1 closed (`a00797e`). Pending: live audio re-confirmation on the real Mac.
**Scope**: Medium — 2 small, independent changes across 3 files. Design inline (documented in spec's Assumptions table).

## Execution Plan (Sequential, but independent — could run in parallel; kept sequential for a single small worker)
```
V1 → V2
```

### V1: Brief spoken summary (local-tts + voicemonkey adapters) ✅
**What**: Add a small shared pure helper (e.g. `src/channels/adapters/spoken-summary.ts` exporting `spokenSummary(notification): string`) — strips a leading run of non-alphanumeric characters (emoji/symbols) plus the following whitespace from `notification.title`; if `title` is absent/empty, returns `notification.message` unchanged. Use it in `local-tts-channel.ts` (replace `text = title ? \`${title}. ${message}\` : message` with `text = spokenSummary(notification)`) and `voicemonkey-channel.ts` (replace `speech = \`${title}. ${message}\`` with `speech = spokenSummary(notification)`). Unit tests for the helper (title with emoji → stripped; title without emoji → unchanged; no title → falls back to message; title that's only symbols → near-empty string, no throw) plus updated adapter tests asserting the new (shorter) request body in the happy-path cases.
**Requirement**: VNR-01 · **Tests**: unit · **Gate**: quick (`npm run test:unit`)
**Commit**: `feat(channels): brief spoken summary for voice channels` (`6a197ae`)

### V2: Sequential playback queue (local-tts-player) ✅
**What**: In `clients/local-tts-player/local-tts-server.mjs`, add `createSpeechQueue()` — a tiny FIFO built on a chained promise (`enqueue(fn)` appends `fn` to the chain via `.then()`, with a `.catch()` per item so one failure doesn't break the chain for subsequent items). `createRequestHandler({ execFileImpl, defaultVoice })` creates ONE queue instance (closed over the handler's scope, so each server/test gets its own, no cross-test leakage) and `speak(...)` enqueues the `execFileImpl('say', [...])` call through it instead of firing it directly — the HTTP response still returns `202` synchronously without awaiting the queued item (unchanged fire-and-forget contract, LTTS-01 AC3). Tests: two `/speak` calls in quick succession with a fake `execFileImpl` that resolves on a controllable delay — assert the second's `execFileImpl` invocation happens only AFTER the first's resolves (sequential, not concurrent); a failing first item doesn't block a second item from still running; queue behavior doesn't change the `202` response timing (assert the HTTP-level `speak()` return is synchronous/immediate as before).
**Requirement**: VNR-02 · **Tests**: unit · **Gate**: quick
**Commit**: `feat(client): sequential playback queue for local tts player` (`e69b0dd`)

## Validation
Verifier runs after V2 (author ≠ verifier): spec-anchored VNR-01/02 + discrimination sensor (esp. sequential-not-concurrent ordering, failure isolation, 202-response-not-delayed, emoji-stripping correctness); writes `.specs/features/voice-notification-refinements/validation.md`. Live audio re-confirmation (both a brief summary and non-overlapping playback) happens after Verifier PASS, on the real Mac.
