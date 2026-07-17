# Voice Monkey Channel — Tasks

**Spec**: `.specs/features/voicemonkey-channel/spec.md`
**Status**: Done — validated (Verifier PASS, iteration 1). 350 tests.
**Scope**: Medium — new channel type, same shape as existing adapters (ntfy/CallMeBot). Design inline, tasks implicit.

## Execution Plan (Sequential)
```
VM1 → VM2
```

### VM1: Voice Monkey adapter + registry ✅
**What**: Research the real, current Voice Monkey Announcement API (endpoint, params, auth, error shape, length limit) via web search/their docs — do NOT fabricate. Implement `src/channels/adapters/voicemonkey-channel.ts` (`VoiceMonkeyChannel implements NotificationChannel` + exported `voicemonkeyRegistryEntry` with verified `requiredConfig` keys and `maxLength` if documented), register one line in `src/channels/channel-registry.ts`. Unit tests (FakeHttpClient): happy path (exact request asserted), non-2xx → throws, 2xx-with-error-body → throws if Voice Monkey does that (mirror the CallMeBot lesson), truncation if a limit exists, UTF-8/accented text survives.
**Tests**: unit · **Gate**: quick (`npm run test:unit`)
**Commit**: `feat(channels): voice monkey (alexa) adapter` (64e240b)
**Result**: verified live against voicemonkey.io/docs/api/announcement + /authentication. Endpoint `POST https://api-v3.voicemonkey.io/announce`, JSON body `{token, device, speech}`. Confirmed Voice Monkey does NOT hide errors behind a 2xx (unlike CallMeBot) — real non-2xx codes with `{"error":"CODE"}` JSON bodies, so no 2xx-lies check needed. No documented `speech` length limit found → `maxLength` intentionally omitted (matches webhook/slack precedent). 7 unit tests added, all pass.

### VM2: Docs ✅
**What**: README channels table row for `voicemonkey` (config keys + setup notes: create Voice Monkey account, add an Echo device, create an "Announcement" monkey, copy token). Note in the row/section that this is the recommended Alexa integration (the official Amazon API was researched and found insufficient — light/banner only, documented in this feature's spec for future reference).
**Tests**: none · **Gate**: build
**Commit**: `docs: voice monkey (alexa) channel setup` (33dbdcf)

## Validation
Verifier runs after VM2 (author ≠ verifier): spec-anchored VM-01/02 + discrimination sensor; writes `.specs/features/voicemonkey-channel/validation.md`. Live end-to-end (real Echo speaking) is NOT verifiable by the agent — requires the user's own Voice Monkey account; flagged as a follow-up for the user to confirm once they've configured it in the panel.
