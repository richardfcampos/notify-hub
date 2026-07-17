# Voice Monkey (Alexa) Channel Validation

**Date**: 2026-07-17
**Spec**: `.specs/features/voicemonkey-channel/spec.md`
**Diff range**: `6ecc012..HEAD` (64e240b adapter, 33dbdcf docs, 5124a27 mark implemented)
**Verifier**: independent sub-agent (author ≠ verifier). READ-ONLY; all scratch mutations reverted.

---

## Verdict: PASS ✅

---

## Independent API-Shape Spot-Check

Fetched Voice Monkey's live v3 docs (`voicemonkey.io/docs/api/announcement`) — the author's claimed contract is **confirmed, not fabricated**, and is NOT a CallMeBot-style "2xx-lies" pattern:

| Claim in code/comments | Live docs say | Match |
| ---------------------- | ------------- | ----- |
| `POST https://api-v3.voicemonkey.io/announce` | GET+POST supported at that URL; POST recommended | ✅ |
| JSON body `{token, device, speech}` (token+device required) | Core params: `token`, `device` (required), `speech` (text→TTS) | ✅ |
| Success `200 {"success":true,"data":"OK"}` | `200` → `{"success":true,"data":"OK"}` | ✅ |
| Errors are REAL non-2xx status + `{"error":"CODE"}` | `400 MISSING_DEVICE`, `404 DEVICE_NOT_FOUND`, `401 INVALID_TOKEN/UNAUTHORIZED`, `429 THROTTLED/MONTHLY_QUOTA_EXCEEDED`, `500 ALEXA_TRIGGER_FAILED` — all non-2xx w/ `error` field | ✅ |
| "Unlike CallMeBot, no 2xx-lies check needed" | Errors use proper HTTP status codes, not hidden in 2xx | ✅ confirmed |

The specific error codes cited in the adapter comments (`INVALID_TOKEN`, `THROTTLED`) appear verbatim in the docs. **No contradiction found.**

---

## Task Completion

| Requirement | Status | Notes |
| ----------- | ------ | ----- |
| VM-01 adapter + registry entry | ✅ Done | `voicemonkey-channel.ts` + registry line |
| VM-02 docs (README row + setup) | ✅ Done | README channel table row + explanatory paragraph |

---

## Spec-Anchored Acceptance Criteria (VM-01)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| AC-1: enabled+valid token/device → sending calls Announce endpoint with the message as spoken text | POST announce URL, body carries token/device + the message text | `voicemonkey-channel.test.ts:33` — `expect(http.calls).toEqual([{method:'POST', url:'https://api-v3.voicemonkey.io/announce', headers:{'content-type':'application/json'}, body:{token:'tok_abc123', device:'echo-kitchen', speech:'Build finished. All tests passed'}}])` | ✅ PASS (⚠️ minor: see note) |
| AC-2: VM error (non-2xx) → adapter throws | throw on non-2xx (queue retry + per-instance isolation) | `test:64` — `expect(error).toBeInstanceOf(Error); expect(error!.message).toMatch(/INVALID_TOKEN/)`; `test:82` — `rejects.toThrow(/THROTTLED.*lockoutUntil=.../)`; `test:98` — 500 → sanitized/redacted; impl `voicemonkey-channel.ts:68` `if (status<200||status>=300) throw` | ✅ PASS |
| AC-3: message exceeds documented length limit (if any) → truncate not error | conditional — worker verified NO documented limit → `maxLength` omitted → generic `TruncatingChannel(Infinity)` = no cap | `test:138` — `expect(voicemonkeyRegistryEntry.maxLength).toBeUndefined()`; generic path `build-instance.ts:44` `maxLength ?? Infinity` | ✅ PASS (condition not triggered; no-cap is intentional + generic truncation seam intact) |
| AC-4: registry declares exact required config keys | `['VOICEMONKEY_TOKEN','VOICEMONKEY_DEVICE']` (matches live API required Core params) | `test:134` — `expect(voicemonkeyRegistryEntry.requiredConfig).toEqual(['VOICEMONKEY_TOKEN','VOICEMONKEY_DEVICE'])`; impl `voicemonkey-channel.ts:110` | ✅ PASS |

**⚠️ Minor spec-precision note (non-blocking, AC-1):** spec says "the notification's *message* as the spoken text"; the adapter sends `${title}. ${message}` (`voicemonkey-channel.ts:55`). The message IS delivered as spoken text (AC satisfied); the title is prepended as a lead-in, consistent with the Slack adapter (`*title*\n message`) and better for TTS context. Additive, not a violation. The test locks the title+message behavior in.

**Status**: ✅ All 4 ACs covered with spec-anchored assertions (1 minor spec-precision note flagged).

---

## Zero-Core-Changes Verification

- Registry diff is **exactly one import + one map entry** (2 insertions, 0 deletions): `channel-registry.ts:14` import + `:25` `voicemonkey: voicemonkeyRegistryEntry`. `requiredConfigByChannel` is derived from the same map (`:30`) — no duplication.
- `buildInstance` (`build-instance.ts:36`) is fully generic: `registry[instance.type]` → `entry.factory` → `TruncatingChannel(entry.maxLength ?? Infinity)` → `LoggingChannel`. **No type-specific branching.** The new `voicemonkey` type flows through the existing per-instance build path unchanged.
- Config validation is generic: `load-config.ts:77` `requiredConfigByChannel[channel] ?? []` — the new required keys are picked up automatically, so the missing-token/device fail-fast edge case needs zero new code (matches spec claim).

---

## Edge Cases

- [x] **Missing token/device on enabled instance → fail-fast**: handled generically via registry-derived `requiredConfigByChannel` + `load-config.ts:77`; no channel-specific code, matches spec ("no changes needed there").
- [x] **Special chars / accents survive**: `test:47` — `speech: 'Café pronto. A reunião começou às 10h'` exact-body match. Real transport JSON-serializes the body (`fetch-http-client.ts:22` `JSON.stringify`), so UTF-8 rides in the request body, not a Latin-1 header — same fix as the ntfy lesson. No header-vs-body pitfall.

---

## Discrimination Sensor

Scratch mutations on `voicemonkey-channel.ts`, one at a time, each reverted via `git checkout`; ran the adapter's test file (7 tests) per mutation.

| # | File:line | Mutation | Expected kill | Killed? |
| - | --------- | -------- | ------------- | ------- |
| a | `voicemonkey-channel.ts:62-63` | Swap `token`/`device` field values in body | exact-body assertion | ✅ Killed (2 tests: exact-body + UTF-8 body) |
| b | `voicemonkey-channel.ts:68` | Treat non-2xx as success (`||`→`&&`, never throws) | error-path tests | ✅ Killed (3 tests: 401, 429, 500 sanitized) |
| c | `voicemonkey-channel.ts:55` | Drop message content (`speech = ''`) | happy-path exact-body | ✅ Killed (2 tests: exact-body + UTF-8) |
| d | `voicemonkey-channel.ts:44` | Wrong endpoint URL (`/announce`→`/trigger`) | exact-URL assertion | ✅ Killed (1 test: exact request) |

**Sensor depth**: lightweight (4 targeted behavior-level mutations).
**Result**: 4/4 injected, 4/4 killed, 0 survived — **PASS ✅**. Tests are discriminating for request shape, endpoint, message content, and error handling.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep | ✅ 111-line adapter, mirrors ntfy/slack structure |
| Surgical changes (only required files) | ✅ adapter + test + 1 registry line + README row |
| Matches existing patterns/style | ✅ constructor(cfg, deps), injected HttpClient, `name` field, registry entry |
| Spec-anchored outcome check (asserted values match spec) | ✅ (1 minor spec-precision note on AC-1) |
| Every test maps to an AC/edge case — no unclaimed tests | ✅ 7 tests → AC-1 (2), AC-2 (3), AC-4 (1), UTF-8 edge (1) |
| Security: secrets not leaked in errors | ✅ `sanitize()` redacts token/device from raw error snippets (`voicemonkey-channel.ts:97`), caps at 160 chars; defense-in-depth beyond documented shape |
| Documented guidelines followed | ✅ project convention "never fabricate an API" — author verified live + Verifier independently re-confirmed |

---

## Gate Check

- **Build**: `npm run build` → tsc clean, admin UI copied. ✅
- **Tests**: `npm run test` → **40 files, 350 passed, 0 failed, 0 skipped** (Docker smoke test is separate, not in this run). ✅
- **Test delta**: +7 new tests in `voicemonkey-channel.test.ts` (happy, UTF-8, 3 error paths, transport error, registry entry). No test count decrease; no assertion weakening.
- **Tree clean after sensor**: yes — only pre-existing untracked files (`.claude/`, `.mcp.json`, `AGENTS.md`, `CLAUDE.md`); tracked adapter restored to HEAD.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| VM-01 | Pending | ✅ Verified |
| VM-02 | Pending | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**API shape spot-check**: confirmed against live v3 docs (endpoint, body, success + non-2xx error codes all match; not a 2xx-lies provider).
**Spec-anchored check**: 4/4 ACs matched spec outcome; 1 minor spec-precision note (title prepended to message — additive, non-blocking).
**Sensor**: 4/4 mutations killed.
**Gate**: 350 passed, build clean.

**What works**: exact Announce request shape (method/url/headers/body) locked by tests; non-2xx → throws with parsed error code; UTF-8/accents survive via JSON body; secrets redacted from error messages; new type flows through generic registry/build-instance/config-validation paths with zero core changes (registry diff = 1 import + 1 map entry).

**Issues found**: none blocking. Minor observation: AC-1 spec says "message" but adapter speaks "title. message" — improvement, consistent with Slack adapter; recommend spec text be updated to reflect intended title+message behavior (documentation nit, not a code fix).

**Next steps**: real end-to-end announcement on the user's own Echo remains an un-automatable follow-up (requires the user's Voice Monkey account), as the spec already notes.
