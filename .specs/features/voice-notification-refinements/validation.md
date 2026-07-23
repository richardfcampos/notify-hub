# Voice Notification Refinements Validation

**Date**: 2026-07-23
**Spec**: `.specs/features/voice-notification-refinements/spec.md`
**Diff range**: `c62b8be..daa72c6` (6a197ae brief summary, e69b0dd sequential queue, daa72c6 docs)
**Verifier**: independent sub-agent (author ≠ verifier), read-only over real tree; all sensor mutations reverted immediately

**Verdict**: PASS ✅ (1 Minor, non-blocking test-discrimination gap)

---

## Spec-Anchored Acceptance Criteria

### VNR-01 — Brief spoken summary (local-tts + voicemonkey)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| AC1: title present → speak title with leading emoji/symbol run stripped, message NOT included | `'✅ notify-hub — concluído'` → `'notify-hub — concluído'`; message excluded | `spoken-summary.ts:33` `return notification.title.replace(LEADING_SYMBOL_RUN,'').trim()` (regex `:20` `/^[^\p{L}\p{N}]+/u`); `spoken-summary.test.ts:14` `toBe('notify-hub — concluído')`; `local-tts-channel.test.ts:31` `toEqual([{…text:'notify-hub — concluído'}])` + `:52` `not.toContain('All tests passed')`; `voicemonkey-channel.test.ts:35` `toEqual([{…speech:'notify-hub — concluído'}])` + `:61` `not.toContain('All tests passed')` | ✅ PASS |
| AC2: no title → fall back to speaking `message` | empty/undefined title → `message` verbatim | `spoken-summary.ts:30` `if (!notification.title) return notification.message`; `spoken-summary.test.ts:40,44` `toBe('All tests passed')`; `local-tts-channel.test.ts:64` `toEqual([{…text:'All tests passed'}])`; `voicemonkey-channel.test.ts:74` `toEqual({…speech:'All tests passed'})` | ✅ PASS |
| AC3: visual channels UNCHANGED | ntfy/telegram/slack/discord/email/webhook keep full title+message | Scope-containment: `git diff c62b8be..daa72c6` touched only `spoken-summary.ts`, `local-tts-channel.ts`, `voicemonkey-channel.ts`, `local-tts-server.mjs` (+tests). 7 visual adapters (discord/email/ntfy/slack/telegram/webhook/whatsapp) not in diff | ✅ PASS |

### VNR-02 — Sequential local playback (local-tts-player)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| AC1: two `/speak` close together → 2nd `say` not started until 1st exits (no overlap) | strict serialization | `local-tts-server.mjs:109-139` array-FIFO: `enqueue` runs only when `!running`, `runNext` chains via `Promise.resolve(result).catch().then(runNext)`; `local-tts-server.test.mjs:194` after 2 enqueues `events===['first:start']`, post-resolve `['first:start','first:end','second:start']`; `:294` shared-queue `execFileImpl` called 1× until first resolves, then 2× | ✅ PASS |
| AC2: a queued item's `say` fails → subsequent items still play | failure isolation | `local-tts-server.mjs:123` (sync-throw → `logSpeakFailure` + `runNext`), `:128` (async reject → `.catch(logSpeakFailure).then(runNext)`); `local-tts-server.test.mjs:223` sync-throw `secondRan===true`, `:243` async-reject `secondRan===true`, `:329` shared-queue `toHaveBeenNthCalledWith(2,'say',['-v','Luciana','after'])` | ✅ PASS |
| AC3: `POST /speak` stays immediate `202` regardless of queue depth | fire-and-forget, caller never waits | `local-tts-server.mjs:154` `speak` is NOT `async`; enqueue not awaited; returns `{status:202}` synchronously; `local-tts-server.test.mjs:129` neverResolve → `result` `toEqual({status:202,…})` synchronously, `:348` three neverResolve all `202`, `:376` handler `statusCode===202` with neverResolve | ✅ PASS |

### Edge Cases

| Edge case | `file:line` + assertion | Result |
| --- | --- | --- |
| 3+ notifications in rapid succession → queue & play in arrival order, none dropped | `local-tts-server.test.mjs:261` `order` `toEqual(['a','b','c'])`, resolver-length checks confirm none start early | ✅ PASS |
| Title ONLY emoji/symbols → speak stripped (near-empty) remainder, no throw, no fallback | `spoken-summary.ts:29-33` (truthy `'✅✅✅'` → strip → `''`); `spoken-summary.test.ts:50` `not.toThrow()`, `:51` `toBe('')` | ✅ PASS |

**Status**: ✅ 5/5 ACs + 2/2 edge cases covered, all matched to spec-defined outcomes. No spec-precision gaps.

---

## Discrimination Sensor

Scratch mutations applied to the real file, targeted test file run, then `git checkout` revert (tree verified clean after each).

| # | File:line | Mutation | Expected | Killed? |
| - | --------- | -------- | -------- | ------- |
| a | `spoken-summary.ts:33` | return `` `${title} ${message}` `` (old title+message behavior) | brief-summary kill | ✅ Killed — 11 failed / 3 files |
| b | `spoken-summary.ts:20` | regex → `/^[^a-zA-Z0-9]+/` (ASCII-only class) | emoji-stripping kill | ❌ **Survived — 23 passed** |
| c | `local-tts-server.mjs:131-136` | `enqueue` always calls `runNext()` (remove `if (!running)` wait-for-previous guard → concurrent) | sequential-ordering kill | ✅ Killed — 3 failed |
| d | `local-tts-server.mjs:128` | drop `.catch(logSpeakFailure)` → async rejection breaks chain | failure-isolation kill | ✅ Killed — 2 isolation tests failed |
| e | `local-tts-server.mjs:154` | make `speak` `async` + `await execFileImpl(...)` before returning `202` | timing-regression kill (highest risk) | ✅ Killed — 8 failed (incl. 202/fire-and-forget) |
| f | `spoken-summary.ts:30` | invert guard `if (notification.title) return message` (fall back even when title present) | fallback kill | ✅ Killed — 15 failed / 3 files |

**Sensor depth**: lightweight fault-injection (6 mutations).
**Result**: 5/6 killed, 1 survived → the critical 202-timing regression (e) is well-covered; the survivor (b) is a Minor test-discrimination gap (details below).

### Surviving mutant (b) — analysis

- **Empirical proof**: `/^[^\p{L}\p{N}]+/u`, `/^[^a-zA-Z0-9]+/`, and `/^[^a-zA-Z0-9]+/u` produce IDENTICAL output for every test input (`✅ notify-hub — concluído`, `🙋 …` (surrogate pair), `🏁 …`, `🤔 …`, `✅✅✅`, `Café pronto`). A leading-run strip greedily consumes emoji surrogate/BMP code units regardless of Unicode-property awareness, so an ASCII downgrade never leaves "byte fragments" here.
- **Shipped code is CORRECT** — it uses the Unicode `\p{L}\p{N}` class. The only behavioral divergence between Unicode and ASCII is a title *starting with a non-ASCII letter* (e.g. `Ótimo`, `Über`, `日本語`), which ASCII would wrongly strip and Unicode correctly keeps. The hook never emits such titles (format `<emoji> <project> — <status>`, ASCII project slugs) → **zero production impact**.
- **Two Minor consequences**: (1) the test suite does not guard the Unicode-property invariant the spec's own wording implies ("leading run of non-letter/digit characters"); a future ASCII refactor would pass green while mis-stripping non-ASCII-letter-leading titles. (2) the `spoken-summary.ts:17-18` comment's stated justification ("a naive ASCII-only class would leave emoji byte fragments behind") is empirically false for leading-run stripping — the real reason for `\p{L}` is to *not* strip a leading non-ASCII letter.
- **Recommended (non-blocking) fix task**: add a `spokenSummary` test with a non-ASCII-letter-leading title (e.g. `spokenSummary({title:'Ótimo resultado', message:'m'})` → `'Ótimo resultado'`) to kill mutant (b); correct the comment's rationale.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| No features beyond what was asked | ✅ |
| No abstractions for single-use code (shared `spokenSummary` helper is 2-consumer, justified) | ✅ |
| Only touched files required for task | ✅ |
| Didn't "improve" unrelated code | ✅ |
| Matches existing patterns (DI seam, injected HttpClient, loopback bind) | ✅ |
| Spec-anchored outcome check (asserted values match spec) | ✅ |
| Every test maps to a spec AC / edge case / Done-when — no unclaimed tests | ✅ |
| Test integrity: no weakening — removed `title+message` assertions REPLACED with stricter brief-summary `toEqual` + `not.toContain` guards | ✅ |
| Injection-safety preserved (`execFile` array args, `:162`; malicious-text test `:118`) | ✅ |
| Secret hygiene preserved (voicemonkey `sanitize` redacts token/device, `:98`) | ✅ |

Array-based FIFO deviation from the spec's suggested `tail.then().catch()` pseudocode is a valid mechanism choice — verified directly that it delivers all three guarantees (sequential AC1, failure-isolated AC2, non-blocking-202 AC3) independent of the literal pseudocode. The choice preserved 13 pre-existing synchronous-assertion tests unmodified.

---

## Gate Check

- **Build**: `npm run build` (`tsc -p tsconfig.json` + admin-ui copy) → exit 0, no errors.
- **Test gate**: `npx vitest run` → **457 passed / 0 failed / 0 skipped**, 53 test files (18.8s). Docker/testcontainers bullmq-retry integration test ran (not skipped).
- **Feature files (isolated)**: 49 passed across the 4 changed test files.
- **Test count**: net-additive — new `spoken-summary.test.ts` suite (8 tests) + new `createSpeechQueue`/shared-queue suites; no test deletions reducing coverage.

---

## Requirement Traceability Update

| Requirement | Previous | New |
| ----------- | -------- | --- |
| VNR-01 Brief spoken summary | Pending | ✅ Verified |
| VNR-02 Sequential playback queue | Pending | ✅ Verified (202-timing regression sensor-confirmed covered) |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 5/5 ACs + 2/2 edge cases matched spec-defined outcomes; 0 spec-precision gaps.
**Scope containment**: confirmed — only the 2 voice adapters + player + new `spoken-summary` helper (+tests) changed; 7 visual channel adapters untouched.
**Sensor**: 6 injected, 5 killed, 1 survived (ASCII-regex, Minor).
**Gate**: 457 passed, build clean.
**Tree**: clean (only pre-existing untracked `.claude/ .mcp.json AGENTS.md CLAUDE.md`); HEAD unchanged at daa72c6.

**Ranked gaps** (non-blocking):
1. Minor — `spoken-summary.ts` Unicode-property invariant not test-discriminated (mutant b survived); shipped code correct, zero production impact under real hook title format. Fix: add non-ASCII-letter-leading-title test + correct the `:17-18` comment rationale.

**Next steps**: feature is releasable. Route gap #1 to an implementer as a low-priority test-strengthening task; not a blocker.

**Gap #1 closed** (`a00797e`): added `spoken-summary.test.ts`'s "Ótimo projeto" case (non-ASCII letter right after the stripped emoji) — kills mutant (b) directly confirmed by re-injecting the ASCII regex and observing the new test fail; corrected the `:16-18` comment rationale to match. Full suite re-run green: 458 passed / 0 failed.
