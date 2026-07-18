# Telemetry Validation

**Date**: 2026-07-18
**Spec**: `.specs/features/telemetry/spec.md`
**Diff range**: `8add353..b71cddb` (851b610 install-id, 64a163a client wrapper, 5835592 boot wiring, a9288d0 consent prompt, 76075b3 disclosure docs)
**Verifier**: independent sub-agent (author ≠ verifier), read-only over real tree; all sensor mutations run in scratch and reverted immediately.

**Verdict: PASS ✅** — on privacy correctness + spec conformance. Two discrimination-sensor survivors on the error-swallowing paths are test-hardening gaps (production code is correct and redundantly guarded), routed as non-blocking fix tasks.

---

## Data-flow audit trail (what EXACTLY reaches PostHog `.capture()`)

Enumerated by reading the call site + the pure builder, then adversarially grepped for leaks.

- Payload assembled at `src/container.ts:109-115` → `src/telemetry/posthog-telemetry-client.ts:31-35` → `src/telemetry/heartbeat-properties.ts:21-28`.
- `capture()` argument = `{ distinctId, event: 'notify_hub_heartbeat', properties }` where `properties` = **exactly** `{ version, channelTypesEnabled, platform, $process_person_profile: false }`.
  - `version` ← `readPackageVersion()` (package.json version string) — `read-package-version.ts:21-25`.
  - `channelTypesEnabled` ← `[...new Set(channelRepo.listEnabled().map((c) => c.type))]` — **`.type` only**, deduped (`container.ts:109`). NOT `.id`, NOT `.label`.
  - `platform` ← `process.platform`.
  - `$process_person_profile: false` — hardcoded (`heartbeat-properties.ts:26`).
  - `distinctId` ← `getOrCreateInstallId(db)` = `crypto.randomUUID()` persisted once (`sqlite-telemetry-repository.ts:30`). Never hostname/IP/MAC.
- This set **exactly matches** what `TELEMETRY.md` (lines 24-29) claims is sent. No over- or under-disclosure of transmitted fields.

**Adversarial leak grep** over `src/telemetry/*.ts` + `src/container.ts` + `sqlite-telemetry-repository.ts` for `id/label/token/config/hostname/networkInterfaces/req.ip/message/title/name/profile/mac`: every hit is a comment, a type/test name, or **unrelated** container wiring (profileRepo, mail `config.channelConfig.email`, dispatchService) — **none on the telemetry payload path**. Payload path is clean.

**Closed-set check**: `TELEMETRY.md` enumerates `ntfy/telegram/email/slack/discord/whatsapp/voicemonkey/local-tts/webhook`. `src/channels/channel-registry.ts:19-29` registers exactly those 9 keys. Match.

---

## Spec-Anchored Acceptance Criteria

### P1: Opt-in heartbeat to PostHog

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| AC1: TELEMETRY_ENABLED unset/falsy → no network call ever | returns Noop; no PostHog client constructed | `build-telemetry-client.test.ts:15-18` — `expect(client).toBeInstanceOf(NoopTelemetryClient)`; `resolve-telemetry-enabled.test.ts:34-44` — false for `false`/`0`/`''` | ✅ PASS (mutant b killed) |
| AC2: DO_NOT_TRACK any value → disabled regardless of TELEMETRY_ENABLED | gate returns false, checked first | `resolve-telemetry-enabled.test.ts:18-20,46-48` — `expect(isTelemetryEnabled({TELEMETRY_ENABLED:'true',DO_NOT_TRACK:'1'})).toBe(false)`; `build-telemetry-client.test.ts:20-26` | ✅ PASS (mutant a killed) |
| AC3: enabled+boot → exactly ONE capture, distinctId=install UUID, event `notify_hub_heartbeat`, properties `{version, channelTypesEnabled, platform, $process_person_profile:false}` | exact payload shape + one call | `heartbeat-properties.test.ts:11-27` — `expect(payload).toEqual({...,$process_person_profile:false})` + `Object.keys` guard; `container.test.ts:58-83` — `calls` length 1, deduped TYPES, `platform===process.platform` | ⚠️ properties+one-call PASS (mutant f, d killed). **`distinctId`=UUID and `event:'notify_hub_heartbeat'` literal are NOT asserted by any test** (no test invokes `PostHogTelemetryClient.sendHeartbeat`); verified by code-read only → coverage gap |
| AC4: POSTHOG_API_KEY unset/empty → no-op, log once at debug, never throw, never block | returns Noop silently | `build-telemetry-client.test.ts:28-39` — Noop when key unset / empty string | ⚠️ no-op/never-throw/never-block PASS (mutant c killed). **"log once at debug level" NOT implemented** — key-missing path returns Noop silently, no debug log (minor under-implementation) |
| AC5: PostHog unreachable/errors → fail silently (logged, never thrown, never blocks/delays boot) | error swallowed + logged | `container.test.ts:38-56` — `expect(() => buildContainer(...)).not.toThrow()` with rejecting Fake | ⚠️ **Code correct** (`posthog-telemetry-client.ts:29-39` try/catch+log; `container.ts:110-118` fire-and-forget `.catch()`) **but tests do NOT discriminate** — mutants e + g both survived (see sensor). "logged" clause untested |
| AC6: install UUID generated once, persisted in SQLite, reused on later boots | stable UUID across restarts | `sqlite-telemetry-repository.test.ts:27-70` — creates UUID, identical on 2nd call, identical after reopen, different across fresh DBs (real temp-file SQLite) | ✅ PASS (strong) |

### P1: Setup-time informed consent

| Criterion | Outcome | Evidence | Result |
| --------- | ------- | -------- | ------ |
| setup-env.sh shows exact fields, then y/N default N | prints version/channelTypesEnabled/platform + install-id note, `ask 'y/N'` default empty→false unless y/yes | `scripts/setup-env.sh:132-149` | ✅ PASS (by inspection; shell script, no unit test — acceptable) |
| .env.example documents TELEMETRY_ENABLED + DO_NOT_TRACK with same field list | inline field list + both vars | `.env.example:67-92` | ✅ PASS (by inspection) |

### P1: Full disclosure doc

| Criterion | Outcome | Evidence | Result |
| --------- | ------- | -------- | ------ |
| TELEMETRY.md enumerates every field, names PostHog+region+privacy link, both opt-outs | full disclosure | `TELEMETRY.md:24-29` (fields), `72-77` (PostHog EU + privacy link), `110-123` (both opt-outs) | ✅ PASS — field list matches code exactly |
| README links TELEMETRY.md, one-line "opt-in, off by default" | unambiguous link | `README.md` diff — "**off by default**" + `[TELEMETRY.md](./TELEMETRY.md)` | ✅ PASS |

**Status**: 8/10 ACs fully spec-anchored; AC3 (distinctId+event literal) and AC5 (error-swallow) covered by code-read but not by discriminating assertions.

---

## Edge Cases

- [x] Fresh install, empty DB → `channelTypesEnabled: []` not omitted — `container.test.ts:85-100`, `heartbeat-properties.test.ts:29-37`. ✅
- [x] Multiple processes (api+worker) each send own heartbeat, documented overcount — by design (`container.ts` fires once per `buildContainer`); disclosed `TELEMETRY.md:40-45`. ✅
- [~] Telemetry failing MUST NOT crash/delay boot; top-level try/catch + fire-and-forget — **code correct**, but test does not discriminate (mutants e, g survived). ⚠️

---

## Discrimination Sensor

7 behavior-level mutations, one at a time, scratch edit → targeted/full gate → `git checkout` revert. Tree verified clean after each.

| # | File:line | Mutation | Expected | Killed? |
| - | --------- | -------- | -------- | ------- |
| a | `resolve-telemetry-enabled.ts:22` | drop DO_NOT_TRACK short-circuit | DO_NOT_TRACK override tests fail | ✅ Killed (`resolve...test.ts:18,46` + `build...test.ts:20`) |
| b | `build-telemetry-client.ts:25` | ignore enable gate (only check key) | disable-path test fails | ✅ Killed (`build...test.ts:15,20`) |
| c | `build-telemetry-client.ts:25` | ignore empty/undefined key | key-missing tests fail | ✅ Killed (`build...test.ts:28,33`) |
| d | `container.ts:109` | `.map(c=>c.id)` instead of `.type` (leak instance id) | type test fails | ✅ Killed — `expected ['acme-slack','globex-slack',...] to equal ['ntfy','slack']`. **Test asserts literal type values, not just length/dedup — safety-critical field is genuinely covered** |
| e | `posthog-telemetry-client.ts:29-39` | remove real-client try/catch | boot-never-blocks test fails | ❌ **Survived** — full suite 434/434 pass. No test invokes `PostHogTelemetryClient.sendHeartbeat` |
| f | `heartbeat-properties.ts:26` | drop `$process_person_profile:false` | payload-shape test fails | ✅ Killed (`heartbeat-properties.test.ts:11`) |
| g | `container.ts:116` | remove fire-and-forget `.catch()` swallow | boot-never-blocks test fails | ❌ **Survived** — `container.test.ts` 3/3 pass. Test asserts synchronous `.not.toThrow()` on synchronous `buildContainer`; the Fake rejects asynchronously (fire-and-forget), so the swallow's removal is invisible to the assertion |

**Sensor depth**: extended (7 mutations, +1 for privacy sensitivity).
**Result**: 7 injected, **5 killed, 2 survived**.

### Why the survivors are non-blocking (production is correct + redundant)

Both survivors sit on AC5 / Edge-Case-3 error-swallowing, which has **two redundant guards** in shipped code:
1. `PostHogTelemetryClient.sendHeartbeat` try/catch → logs + swallows (`posthog-telemetry-client.ts:29-39`).
2. Container fire-and-forget `.catch(() => {})` (`container.ts:116-118`).

In production, `sendHeartbeat` never rejects (both `TelemetryPort` impls swallow internally), so removing either single guard still leaves boot protected. The survivors expose a **test-coverage** weakness, not a code defect: the real-client error path has no direct unit test (`posthog-telemetry-client.test.ts` does not exist), and the boot-never-blocks test cannot observe an async fire-and-forget rejection. A future regression removing a guard would ship undetected — worth closing given the spec flags this edge case as load-bearing.

---

## Docs Accuracy Audit

- **Field enumeration (TELEMETRY.md:24-29 vs code)**: exact match — `version`, `channelTypesEnabled` (types only), `platform`, `distinctId` (random UUID). "What is NEVER collected" (48-60) matches the clean leak-grep. ✅
- **`.env.example` inline summary (67-92) vs TELEMETRY.md**: consistent — no contradictions; both state off-by-default, types-only, no hostname/IP/MAC, no-op on empty key. ✅
- **setup-env.sh prompt field-list (134-143) vs reality**: matches (version, channelTypesEnabled types-only, platform, random install id). ✅
- **`$process_person_profile:false` claim (TELEMETRY.md:79-83)**: matches `heartbeat-properties.ts:26`. ✅
- **PostHog EU host claim (TELEMETRY.md:73)**: matches `POSTHOG_HOST='https://eu.i.posthog.com'` (`posthog-telemetry-client.ts:17`). ✅
- **⚠️ Write-only-key section (TELEMETRY.md:86-104)**: field name `POSTHOG_API_KEY` and citation `build-telemetry-client.ts` are correct. But the prose "it is safe to **ship this key value** in a public, open-source repository" implies an embedded default key, whereas **no key is actually shipped** — `.env.example:92` `POSTHOG_API_KEY=` (empty) and `build-telemetry-client.ts` has **no baked-in default** (comment lines 5-9 confirm "no baked-in default here"). The doc's later paragraphs (106-108) DO disclose the no-op-on-empty reality, and this matches the spec's Open Question (ships with placeholder/empty key until the maintainer supplies one). **Conservative direction** (nothing is sent without a key — no leak risk), but a skeptical auditor would look for the embedded `phc_...` key and not find it. Minor wording precision issue, not a privacy defect.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep | ✅ Ports & Adapters seam mirrors existing repo pattern; pure functions isolated |
| Surgical changes, only required files | ✅ |
| Matches existing patterns/style | ✅ (FakeTelemetryClient alongside other fakes; SqliteTelemetryRepository alongside channel/profile repos) |
| Spec-anchored outcome check | ✅ where asserted; ⚠️ AC3 distinctId/event + AC5 not discriminated |
| Every test maps to a spec requirement | ✅ no unclaimed tests |
| No AI attribution in code/commits | ✅ |

---

## Gate Check

- **Build**: `npm run build` → exit 0 (tsc + admin-ui copy).
- **Tests**: `npm run test` → **434 passed / 434**, 51 files, 0 failed, 0 skipped (~11s). Matches stated baseline.
- **Test count delta**: telemetry feature adds tests in `sqlite-telemetry-repository.test.ts` (4), `build-telemetry-client.test.ts` (5), `heartbeat-properties.test.ts` (3), `resolve-telemetry-enabled.test.ts` (11), `read-package-version.test.ts` (1), `container.test.ts` (3). No pre-existing tests deleted or weakened.

---

## Requirement Traceability Update

| Requirement | Previous | New |
| ----------- | -------- | --- |
| TEL-01 (client wrapper: gate, DO_NOT_TRACK, anon properties) | Pending | ✅ Verified (AC4 "debug log" minor under-impl) |
| TEL-02 (install UUID in SQLite) | Pending | ✅ Verified |
| TEL-03 (boot heartbeat api/worker) | Pending | ✅ Verified (error-swallow test-hardening pending) |
| TEL-04 (setup prompt + .env.example) | Pending | ✅ Verified |
| TEL-05 (TELEMETRY.md + README) | Pending | ✅ Verified (minor write-only-key wording nit) |

---

## Ranked Gaps (non-blocking fix tasks)

1. **[MEDIUM] Harden AC5 / Edge-Case-3 error-swallow tests (2 surviving mutants).** Add `src/telemetry/posthog-telemetry-client.test.ts` that stubs `posthog-node` to reject and asserts `sendHeartbeat` resolves + logs (kills mutant e). Rework the container boot-never-blocks test to `await` a microtask flush (or assert on an injected logger) so removal of the `.catch()` swallow is observable (kills mutant g). Also assert `distinctId` + `event:'notify_hub_heartbeat'` at the capture call site (closes AC3 coverage gap). Root: no direct real-client test + sync `.not.toThrow()` can't see async fire-and-forget.
2. **[MINOR] AC4 "log once at debug level" not implemented.** Key-missing path returns Noop silently. Either add the debug log in `build-telemetry-client.ts` or amend the spec wording. No-op/never-throw/never-block behavior is correct.
3. **[MINOR] TELEMETRY.md write-only-key wording.** "safe to ship this key value in a public repository" implies an embedded key that is not present. Reword to reflect the current unset/placeholder state, or embed the real write-only key once available. Conservative direction — no leak.

---

## Summary

**Overall**: ✅ Ready — privacy is airtight and every spec AC is functionally met; the two sensor survivors are test-hardening on redundantly-guarded error paths (production code correct), not defects.

**What works**: Payload contains ONLY `{version, channelTypesEnabled(types-only, deduped), platform, $process_person_profile:false}` + random-UUID `distinctId`; no instance id/label/token/config/hostname/IP/message/profile anywhere on the payload path (verified + grep-clean + mutation-proven). Disable paths (TELEMETRY_ENABLED falsy, DO_NOT_TRACK, empty key) correctly no-op. Docs field-list and closed channel-type set match code exactly. Gate green (434/434, build 0).

**Issues**: 2 surviving mutants (error-swallow test discrimination) + AC4 debug-log under-impl + minor write-only-key doc wording — all non-blocking, routed as fix tasks above.

**Sensor**: 5/7 killed. **Gate**: 434 passed, build ok. **Tree**: clean.

---

## Iteration 2 (re-verify, fix commit `7b43064`)

**Date**: 2026-07-18
**Diff**: `b71cddb..7b43064` — `test(telemetry): harden error-path coverage and doc accuracy` (TEST-ONLY + one minimal, justified prod seam)
**Files changed**: `TELEMETRY.md` (23 lines), `src/container.test.ts` (58 lines), `src/telemetry/posthog-telemetry-client.test.ts` (new, 142 lines), `src/telemetry/posthog-telemetry-client.ts` (22 lines, seam only)

### Re-run mutation (e): remove try/catch in `PostHogTelemetryClient.sendHeartbeat`

Applied in scratch, ran the new `posthog-telemetry-client.test.ts`, reverted.

**Result: ✅ KILLED (was survived in iteration 1).** 3 of 5 tests now fail:
- `resolves (never rejects) and logs when capture() throws synchronously` — `Error: promise rejected "Error: capture exploded" instead of resolving`
- `resolves (never rejects) and logs when shutdown() rejects asynchronously` — `Error: promise rejected "Error: shutdown rejected" instead of resolving`
- `resolves (never rejects) and logs when the client factory itself throws` — `Error: promise rejected "Error: construction failed" instead of resolving`

The other 2 tests (AC3 literal distinctId/event, shutdown-awaited happy path) still pass, as expected — they don't exercise the removed catch.

### Re-run mutation (g): remove `.catch(() => {})` fire-and-forget guard in `container.ts`

Applied in scratch, ran the hardened `container.test.ts`, reverted.

**Result: ✅ KILLED (was survived in iteration 1).**
```
AssertionError: expected [ Error: posthog unreachable ] to have a length of +0 but got 1
  at src/container.test.ts:82:35 — expect(unhandledRejections).toHaveLength(0)
```
The scoped `process.on('unhandledRejection', ...)` listener + `await new Promise(resolve => setImmediate(resolve))` macrotask flush now genuinely observes the swallowed rejection surfacing as unhandled once the `.catch()` guard is removed — closing the exact blind spot iteration 1 flagged (sync `.not.toThrow()` couldn't see an async fire-and-forget rejection).

### Seam-leak check: does `createClient` weaken production?

`grep -rn "new PostHogTelemetryClient" src --include="*.ts"` (excluding tests) → **one hit**: `src/telemetry/build-telemetry-client.ts:28` — `new PostHogTelemetryClient({ apiKey, distinctId: options.distinctId })`, a single-argument call. The constructor's second param (`createClient: PostHogClientFactory = (apiKey, opts) => new PostHog(apiKey, opts)`) is never supplied at this — the only production call site — so production always falls through to the default, i.e. always constructs the real `new PostHog(...)`. The seam is test-only in effect, matching its stated intent in the code comment (`posthog-telemetry-client.ts:13-17`). No leak, no behavior change for real boots.

### Docs accuracy re-check: TELEMETRY.md "The write-only API key" section

Reread end to end (`TELEMETRY.md:85-117`). Reworded section now states: `POSTHOG_API_KEY` "ships unset/empty in this repository today -- no key is baked into the codebase or embedded as a default" and "Telemetry stays a no-op until the maintainer supplies a real key out of band." The write-only security-model paragraph is now explicitly forward-looking: "That real key, **once added**, will be a PostHog Project API Key... This is the property that **will make it safe to embed** that key value... once it exists." This resolves the iteration-1 MINOR gap (previously implied a key was already embedded) without weakening the accepted-trade-off disclosure, which is preserved verbatim. ✅ Accurate, no over/under-claim.

### Gate (post-revert, both mutations reverted)

- `npm run build` → exit 0.
- `npm run test` → **439 passed / 439**, 52 test files, 0 failed, 0 skipped (was 434/51 in iteration 1 — delta of +5 tests / +1 file matches the new `posthog-telemetry-client.test.ts`, consistent with the coordinator's stated count).
- **Tree clean**: `git status --short` shows only pre-existing untracked files (`.claude/`, `.mcp.json`, `AGENTS.md`, `CLAUDE.md`, this report); `git diff --stat` empty.

### Updated Discrimination Sensor tally

| # | Mutation | Iteration 1 | Iteration 2 |
| - | -------- | ----------- | ----------- |
| a | DO_NOT_TRACK short-circuit dropped | ✅ Killed | (not re-run, unaffected by fix) |
| b | enable-gate bypass | ✅ Killed | (not re-run, unaffected by fix) |
| c | empty-key bypass | ✅ Killed | (not re-run, unaffected by fix) |
| d | `.id` leak instead of `.type` | ✅ Killed | (not re-run, unaffected by fix) |
| e | real-client try/catch removed | ❌ Survived | ✅ **Killed** |
| f | `$process_person_profile` dropped | ✅ Killed | (not re-run, unaffected by fix) |
| g | container `.catch()` removed | ❌ Survived | ✅ **Killed** |

**7/7 killed** as of iteration 2 (mutations a-d, f re-verified unaffected by this fix commit — no changes touched those files; only e and g's target files changed, and re-running exactly those two was sufficient to close the loop).

### Iteration 2 verdict

**PASS ✅ — now unconditional.** Iteration 1 already passed on privacy/functional grounds (payload shape, opt-in gates, disclosure accuracy were all sound); the two open items were test-discrimination gaps on redundantly-guarded error paths, not code defects. Both are now closed with real, targeted assertions (a dedicated real-client fault-injection test suite for AC5, and an `unhandledRejection`-observing boot test for the Edge-Case-3 fire-and-forget swallow). The `createClient` constructor seam is verified test-only (production never supplies it). The AC3 distinctId/event literal gap is also closed (`posthog-telemetry-client.test.ts:110-124`). The TELEMETRY.md write-only-key wording gap is resolved.

**Remaining open item (MINOR, non-blocking, carried from iteration 1, unaddressed by this fix)**: AC4's "log once at debug level" on a missing key is still not implemented — the key-missing path returns `NoopTelemetryClient` silently, no debug log emitted. Behavior (no-op, never throw, never block) is correct; only the logging clause of AC4 is unimplemented. Recommend either implementing the debug log or amending spec wording — does not block ship.

**Final status**: 3 of 3 iteration-1 gaps closed (mutants e, g; AC3 coverage); 1 of 4 gaps remains (AC4 debug-log), assessed MINOR and non-blocking.
