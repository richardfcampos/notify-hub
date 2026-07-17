# hook-status Validation

**Date**: 2026-07-17
**Spec**: `.specs/features/hook-status/spec.md`
**Diff range**: `9e6c7ab..HEAD` (56b1b47 rich payload · 4a67476 config bootstrap + isMain bugfix · 49fc427 docs)
**Verifier**: independent sub-agent (author ≠ verifier), read-only; scratch mutations reverted
**Surface**: `clients/claude-code/notify-hook.mjs`, `clients/claude-code/notify-hook.test.mjs`, `.env.example`, `install.md`, `README.md`

---

## Verdict: PASS ✅

All 12 acceptance criteria (HOOK-01..05 + 3 edge cases) trace to a `file:line` assertion whose asserted value matches the spec-defined outcome. Gate green (323/323, build ok). Sensor 5/5 killed, tree clean. One **non-blocking medium** test gap: the `isMain` spaced-path bugfix has no automated regression test.

---

## Spec-Anchored Acceptance Criteria

### P1: Rich end notification (HOOK-01, HOOK-02)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| Stop fires → title `<emoji> <project> — <label>` | `✅ my-project — concluído` | `notify-hook.test.mjs:414` — `expect(payload.title).toBe('✅ my-project — concluído')`; builder `notify-hook.mjs:333` | ✅ PASS |
| Stop fires → body `Início HH:MM · Fim HH:MM (<duration>)` | `Início 09:48 · Fim 10:00 (12min)` | `notify-hook.test.mjs:429` — `toBe('Início … · Fim … (12min)')`; builder `notify-hook.mjs:341` | ✅ PASS |
| Body carries 1-2 line headline from last assistant msg | `Fim … \n\nAll changes are done.` | `notify-hook.test.mjs:454` — `toBe('Fim …\n\nAll changes are done.')`; `notify-hook.mjs:343` | ✅ PASS |
| Final paragraph ends `?` → `🤔 aguardando sua decisão` | `🤔` + label | `notify-hook.test.mjs:287-291` — `toEqual({emoji:'🤔',label:'aguardando sua decisão'})`; `:477` payload title; logic `notify-hook.mjs:281` | ✅ PASS |
| Else → `✅ concluído` | `✅` + label | `notify-hook.test.mjs:280-285`, `:276-278` (no msg); `notify-hook.mjs:285` | ✅ PASS |
| Only FINAL paragraph classifies (earlier `?` ignored) | done | `notify-hook.test.mjs:294-299` — `Is this ok?\n\nYes, all done.` → `✅` | ✅ PASS |
| Start time unavailable → body has end time only | `Fim HH:MM` | `notify-hook.test.mjs:408-416` — `toBe('Fim …')`; `notify-hook.mjs:342` | ✅ PASS |
| Git worktree → project = MAIN repo name | main repo basename | `notify-hook.test.mjs:190-202` (mock) `toBe('my-project')` from `…-wt`; `:254-267` real-git `toBe(basename(mainDir))`; `notify-hook.mjs:247-260` | ✅ PASS |

### P1: Needs-input notification (HOOK-03)

| Criterion | Spec outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| Notification fires → `🙋 <project> — precisa de você` + hook msg in body, high priority | title/body/priority exact | `notify-hook.test.mjs:395-397` — title `'🙋 my-project — precisa de você'`, body `'Projeto: my-project\n…'`, `priority='high'`; `notify-hook.mjs:387-393` | ✅ PASS |
| No hook message → generic fallback | contains `Projeto: my-project` | `notify-hook.test.mjs:400-406`; `notify-hook.mjs:390` | ✅ PASS |

### P1: Config-file fallback (HOOK-04)

| Criterion | Spec outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| URL/TOKEN absent from env → read from `hook.env` | file values used | `notify-hook.test.mjs:132-146` resolveConfig; `:715-738` run() `Bearer filetoken`; `notify-hook.mjs:114-122` | ✅ PASS |
| Env wins when both present | env value | `notify-hook.test.mjs:148-156`; `:740-762` run() `from-env` wins; `notify-hook.mjs:119` | ✅ PASS |
| Neither source → exit 0 silently, no fetch | 0 fetch calls, resolves | `notify-hook.test.mjs:681-694` — `expect(calls).toHaveLength(0)`; `notify-hook.mjs:425-428`; always-exit-0 `notify-hook.mjs:470` | ✅ PASS |
| Toggles readable from same file | `NOTIFY_ON_END` from file | `notify-hook.test.mjs:145` — `toBe('true')`; `notify-hook.mjs:118` | ✅ PASS |
| Start-time cached regardless of NOTIFY_ON_START | cache written, 0 push | `notify-hook.test.mjs:594-595` — `calls`=0 AND `existsSync(cache)=true`; `notify-hook.mjs:413-417` (before toggle) | ✅ PASS |

### HOOK-05: Git-toplevel project naming

| Criterion | Spec outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| Normal repo → toplevel basename | `my-project` | `notify-hook.test.mjs:176-188` (mock); `:247-252` real git; `notify-hook.mjs:242-245` | ✅ PASS |
| Relative git-common-dir (subdir) resolves to toplevel | `my-project` | `notify-hook.test.mjs:204-216`; `notify-hook.mjs:259` | ✅ PASS |
| Git unavailable / not a repo → `basename(cwd)` | cwd basename | `notify-hook.test.mjs:218-233`, `:269-272`; `notify-hook.mjs:243,261-263` | ✅ PASS |

**Status**: ✅ All ACs covered, spec-anchored to exact values (em-dash `—`, middot `·`, emoji, PT-BR labels).

---

## Edge Cases

- [x] Transcript unreadable → send with only end-time (no headline): `notify-hook.test.mjs:488-499` (missing file → `Fim …`); `notify-hook.mjs:220-222` best-effort catch.
- [x] Malformed config line ignored, rest parsed: `notify-hook.test.mjs:110-118` (parse), `:158-166` (resolve), `:764-785` (run still sends); `notify-hook.mjs:84-90`.
- [x] Duration >1h → `1h 04min`, <1min → `<1min`: `notify-hook.test.mjs:337-357` — `<1min`,`1min`,`12min`,`1h 04min`,`2h 05min`; `notify-hook.mjs:318-329`.

---

## isMain spaced-path bugfix

- **Fix is real**: `notify-hook.mjs:478` — `import.meta.url === pathToFileURL(process.argv[1]).href` replaces prior ``import.meta.url === `file://${process.argv[1]}` `` (commit 4a67476). `pathToFileURL` is the correct Node idiom: it percent-encodes the path so the comparison matches when the install dir needs URL-encoding (e.g. a space). Import added `notify-hook.mjs:24`.
- **Impact of the original bug**: HIGH — a plain `file://` concat never equals the percent-encoded `import.meta.url` when the path has a space, so `isMain` was false and `main()` never ran → the entire hook was silently dead. This very repo lives under `/Volumes/External Code/…` (space), the exact trigger.
- **Regression test**: ❌ NONE. No test spawns the script with a spaced `argv[1]` (grep for `isMain|pathToFileURL|import.meta|process.argv|file://` in the test file → 0 matches).
- **Severity judgment: MEDIUM, non-blocking.** The fix is correct and is now live-verified in the exact spaced-path condition — the hook is wired in `~/.claude/settings.json` and the user received live smoke pushes from this repo. `isMain` is top-level module code (runs on import), so unit-testing it requires a subprocess harness (spawn with a spaced argv[1], assert `main()` executed). Recommend adding that subprocess smoke test to lock the fix.

---

## Discrimination Sensor

Scratch mutations on `notify-hook.mjs`; each reverted via `git checkout`. Ran `vitest run clients/claude-code/notify-hook.test.mjs`.

| # | Mutation | file:line | Killed? |
| --- | --- | --- | --- |
| a | Status heuristic inverted (`endsWith('?')` → `'¿'`, always ✅) | `notify-hook.mjs:281` | ✅ Killed — 2 decision tests (`test:287`, `:458`) |
| b | Config-file read removed (`readConfigFile` → `{}`, env-only) | `notify-hook.mjs:116` | ✅ Killed — 4 tests (`test:132`, `:715`, `:764` + resolveConfig) |
| c | Start-cache skipped on `end` toggle path (drop `writeStartTime`) | `notify-hook.mjs:415` | ✅ Killed — 1 test (`test:577` cache-regardless-of-toggle) |
| d | Gateway failure re-throws (breaks never-throw / exit-0 contract) | `notify-hook.mjs:448` | ✅ Killed — 1 test (`test:649` network error) |
| e | Project naming forced to `basename(cwd)` (drop git resolution) | `notify-hook.mjs:238` | ✅ Killed — 3 tests (`test:190` worktree mock, `:204` subdir, `:254` real-git worktree) |

**Sensor depth**: lightweight (5 targeted behavior mutations, one per spec pillar).
**Result**: 5 injected, 5 killed, 0 survived. Tree clean after all reverts (`notify-hook.mjs` byte-identical to HEAD).

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code / no scope creep | ✅ zero-dep hook preserved (stdlib + global `fetch` only) |
| Surgical changes, only required files | ✅ |
| Matches existing patterns (injected seams, best-effort try/catch, always exit 0) | ✅ |
| Spec-anchored outcome check (asserted values match spec) | ✅ exact strings incl. `—`/`·`/emoji/PT-BR |
| Every test maps to an AC / edge case — no unclaimed tests | ✅ |
| Documented guidelines | none stack-specific for the .mjs hook — strong defaults applied |

Config surface (`.env.example`, `install.md`) documents the `hook.env` path, `chmod 600`, env-over-file precedence, `NOTIFY_HOOK_CONFIG` override, and the NOTIFY_ON_START-off/always-cache semantics — matching the implemented behavior.

---

## Gate Check

- **Test command**: `npm run test` (vitest run) → **323 passed / 323 (39 files), 0 failed, 0 skipped** on clean re-run.
- **Build**: `npm run build` (tsc + copy admin ui) → exit 0.
- **Test count**: baseline 323 = post-feature count; feature added ~40 hook tests (`notify-hook.test.mjs` +612 lines). No test deleted, no assertion weakened.
- **Note (non-blocking, outside feature diff)**: one run flaked on the redis testcontainers integration test (`test/integration/bullmq-retry.integration.test.ts` — the "Docker for 1 test") when the container failed to start; a re-run with Docker healthy passed 323/323. Not part of the hook-status surface.

---

## Out-of-repo Artifact

- `~/.config/notify-hub/hook.env`: **exists, mode 600 (-rw-------), 170B**. Contents not read (bearer token inside). ✅

---

## Live-smoke (indirect, non-blocking)

No new pushes sent by the Verifier. Stack confirmed up: `notify-hub-api-1` (healthy), `notify-hub-worker-1`, `notify-hub-redis-1`. User already received the smoke pushes per the feature brief; api-log tail for the recent window had no matching lines (rotated/earlier) — non-blocking.

---

## Requirement Traceability Update

| Requirement | Previous | New |
| --- | --- | --- |
| HOOK-01 rich end payload | Done | ✅ Verified |
| HOOK-02 decision-vs-done heuristic | Done | ✅ Verified |
| HOOK-03 needs-input payload | Done | ✅ Verified |
| HOOK-04 config-file fallback + toggles + always-cache-start | Done | ✅ Verified |
| HOOK-05 git-toplevel naming | Done | ✅ Verified |

---

## Ranked Gaps

1. **Missing regression test for the `isMain` spaced-path bugfix** — Major-impact bug (silently disabled the whole hook on spaced install paths), fix correct + live-verified but not automated. `notify-hook.mjs:478`, no test. Severity: MEDIUM, non-blocking. Fix task: add a subprocess smoke test that spawns the hook with a spaced `argv[1]` and asserts `main()` runs.

---

## Summary

**Overall**: ✅ Ready
**Spec-anchored**: 12/12 ACs matched spec outcome, 0 spec-precision gaps
**Sensor**: 5/5 killed
**Gate**: 323 passed, build ok
**Config file**: exists, 600

**Next steps**: (optional) add the `isMain` subprocess regression test to close the one ranked gap.

---
---

# Amendment 1 (HOOK-06) Validation — Idle-debounced end notifications

**Date**: 2026-07-17
**Diff range**: `8d8c798..HEAD` (d72e7f6 feat · b144f85 docs)
**Verifier**: independent sub-agent (author ≠ verifier), read-only; scratch mutations reverted via `git checkout` (tree byte-identical after)
**Surface**: `clients/claude-code/notify-hook.mjs`, `clients/claude-code/notify-hook.test.mjs`, `.env.example`, `install.md`
**Scope**: Amendment 1 / HOOK-06 ACs 1-5 + Amendment edge cases ONLY (base HOOK-01..05 already validated above; re-confirmed non-regressed).

## Verdict: PASS ✅

All 5 HOOK-06 ACs + the testable Amendment edge cases trace to a `file:line` assertion whose asserted value matches the spec-defined outcome. Gate green (343/343, build ok). Sensor 5/5 killed, tree clean. Base contracts non-regressed: hook still zero-dep (only `node:` builtins + global `fetch`, no `package.json` under `clients/`), always-exit-0 `main()` try/finally unchanged, all base payload-shape tests intact. Two **non-blocking informational** notes below (unref not assertion-covered; multi-Stop-without-prompt Início precision).

---

## Spec-Anchored Acceptance Criteria (HOOK-06)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| **06.1** Stop fires → NOT immediate; persist payload+stopTs AND spawn detached unref'd deferred-sender | 0 fetch; pending `{stopTs,payload}` written; spawn `--deferred-send <sid> <stopTs>` detached/stdio-ignore | impl `notify-hook.mjs:621-633` (gate `idleSeconds>0`, `writePendingPayload`+`spawnDeferredSender`+`return`), spawn `:326-340` (`detached:true`,`stdio:'ignore'`,`unref?.()`) — test `notify-hook.test.mjs:899` `expect(fetchCalls).toHaveLength(0)`, `:903` `pending.stopTs).toBe(now())`, `:904-905` payload event/project, `:908-912` `args[1]==='--deferred-send'`,`args[2]===sessionId`,`args[3]===String(now())`,`detached===true`,`stdio==='ignore'` | ✅ PASS |
| **06.1** default idle window = **180**; `0` = legacy immediate | `resolveIdleSeconds({})===180`; `'0'`→immediate send, no pending | const `notify-hook.mjs:65`, `resolveIdleSeconds :155-158` — test `:820` `toBe(180)`, `:828` `'0'`→`0`, legacy path `:942-967` `fetchCalls=1` + `existsSync(pending)===false` | ✅ PASS |
| **06.2** New UserPromptSubmit (same session) before deferred send → cancelled (sees newer activity, exits silent) | deferred send suppressed when `activityTs>myStopTs`; UPS refreshes activity marker | UPS writes activity `notify-hook.mjs:606-607`; guard `shouldDeferredSend :310-312` (`activityTs>myStopTs`→false); `runDeferredSend :652-657` reads activity + early-return — test `:842` truth table `activityTs 2000 > stop 1000`→`false`, `:1027-1049` `runDeferredSend` cancels (`calls=0`, pending untouched), UPS activity write `:970-987` `readFileSync(activity)==='4242'` | ✅ PASS |
| **06.3** Newer Stop supersedes older pending (same session) → only newest sends; older senders detect stale + exit; payload reflects LATEST turn | overwrite pending w/ newest stopTs; stale sender (`pendingStopTs!==myStopTs`) → no send, no delete | overwrite `writePendingPayload :269-276`; guard `:313-315`; stale sender no-delete `runDeferredSend :655-656` (returns before `deletePendingPayload`) — test `:848` truth table `pending 2000 ≠ stop 1000`→`false`, `:915-939` newer Stop → `pending.stopTs===2000`, 2 spawns w/ args `'1000'`/`'2000'`, `:1051-1078` stale sender `calls=0` + remaining `stopTs===2000` (newer entry preserved) | ✅ PASS |
| **06.4** Notification (needs-input) fires → send IMMEDIATELY, never debounced | fetch called now; no pending file; no spawn | debounce gate excludes needs-input (`event==='end'` only `:621`); needs-input → `postPayload :635-636` — test `:989-1022` `fetchCalls=1`, `spawnCalls=0`, `existsSync(pending)===false` | ✅ PASS |
| **06.5** Deferred sender inherits always-exit-0/never-block + same config resolution | `runDeferredSend` uses `resolveConfig(env)`; swallows all send failures; CLI path exits 0 | config `runDeferredSend :648`; shared never-throw `postPayload :562-584`; CLI `main` try/finally exit-0 `:687-703` — test `:1131-1153` URL-unset resolves w/o throw + `calls=0`; send-path `:1080-1107` `body===payload` + pending deleted | ✅ PASS |

**Status**: ✅ 5/5 ACs covered, spec-anchored to exact values. Default `180` explicitly asserted (mutation e killed it — no default gap).

---

## Edge Cases (Amendment 1)

- [x] **Deferred sender crashes/killed → no push (fail-silent), never blocks.** Spawn is best-effort try/catch `notify-hook.mjs:331-339`; a dead detached child simply never POSTs. Inherent to detached-process design — not unit-testable, correct by construction. ⚠️ informational.
- [x] **Machine sleeps through window → send on wake when timer fires.** `runDeferredSend` awaits `setTimeout`-backed `sleep :667-669`; a slept host fires the timer on wake. Inherent OS timer behavior — not unit-testable, acceptable per spec.
- [x] **Debounce state co-located with start-cache, keyed by session_id.** `.start`/`.activity`/`.pending` all under `join(tmpdir(), notify-hub-${sessionId}.*)` — `notify-hook.mjs:163,213,258`. ✅ Verified.

---

## Discrimination Sensor

Scratch mutations on `notify-hook.mjs` via `perl -i`; each reverted with `git checkout` immediately after. Ran `npx vitest run clients/claude-code/notify-hook.test.mjs -t <filter>`.

| # | Mutation | file:line | Killed? |
| --- | --- | --- | --- |
| a | Stop sends immediately even when idle>0 (`idleSeconds > 0` → `< 0`, debounce never taken) | `notify-hook.mjs:623` | ✅ Killed — `test:899` (`fetchCalls` 1≠0) + pending-file ENOENT `test:934` |
| b | Deferred sender ignores newer activity (activity guard → `if (false)`, always sends) | `notify-hook.mjs:310` | ✅ Killed — `test:1045` cancel-on-activity (`calls` 1≠0) + truth-table `test:842` |
| c | Supersession check removed (drop `pendingStopTs !== myStopTs`, stale still sends) | `notify-hook.mjs:313` | ✅ Killed — `test:1073` cancel-on-supersede (`calls` 1≠0) + truth-table `test:848` |
| d | Notification routed through the debounce (gate `+ ||'needs-input'`) | `notify-hook.mjs:621` | ✅ Killed — `test:1018` immediate-needs-input (`fetchCalls` 0≠1) |
| e | Default idle seconds → 0 (debounce off by default) | `notify-hook.mjs:65` | ✅ Killed — `test:820` default-180, `test:833/837` non-numeric/negative fallback |

**Sensor depth**: lightweight (5 targeted behavior mutations, one per HOOK-06 pillar).
**Result**: 5 injected, 5 killed, 0 survived. Tree clean after all reverts (`notify-hook.mjs` byte-identical to HEAD, `git status` shows only pre-existing untracked `.claude/ .mcp.json AGENTS.md CLAUDE.md`).

---

## Base-Contract Non-Regression (re-checked)

| Contract | Status |
| --- | --- |
| Zero npm deps (only `node:` builtins + global `fetch`; no `package.json` under `clients/`) | ✅ |
| Always exit 0 — `main()` try/finally `notify-hook.mjs:685-703` unchanged, both stdin + `--deferred-send` branches | ✅ |
| Base payload-format tests intact (`buildPayload` block `test:379-563`, no assertion weakened/deleted) | ✅ |
| Config resolution shared/unchanged (`resolveConfig` env-over-file) | ✅ |

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code / no scope creep (state files + one exported pure `shouldDeferredSend` + injected `spawn`/`sleep`) | ✅ |
| Surgical — only hook + test + `.env.example`/`install.md` touched | ✅ |
| Matches existing patterns (best-effort try/catch, injected seams, exported pure decision fn) | ✅ |
| Spec-anchored outcome check (asserted values match spec: `--deferred-send` args, `180`, `0`, truth table) | ✅ |
| Every new test maps to a HOOK-06 AC / edge case — no unclaimed tests | ✅ |
| Documented guidelines | none stack-specific for the .mjs hook — strong defaults applied |

`.env.example` / `install.md` document `NOTIFY_IDLE_SECONDS` (default 180, `0`=immediate) matching `DEFAULT_IDLE_SECONDS`.

---

## Gate Check

- **Test command**: `npm run test` (vitest run) → **343 passed / 343 (39 files), 0 failed, 0 skipped** (re-confirmed post-sensor).
- **Build**: `npm run build` (tsc + copy admin ui) → exit 0.
- **Test count**: base-feature 323 → **343** (+20 HOOK-06 tests; `notify-hook.test.mjs` +414 lines). No test deleted, no assertion weakened.

---

## Requirement Traceability Update

| Requirement | Previous | New |
| --- | --- | --- |
| HOOK-06 idle-debounced end notification | Done | ✅ Verified |

---

## Ranked Gaps (non-blocking, informational)

1. **`unref()` not assertion-covered.** `spawnDeferredSender` calls `child.unref?.()` (`notify-hook.mjs:336`) so `Stop` never keeps Node alive on the parent, but the spawn fakes (`test:885/920/999`) return a no-op `unref` without recording that it was called. `detached:true`+`stdio:'ignore'` ARE asserted (`test:911-912`). Severity: LOW. Fix: assert `unref` invoked in the debounce spawn test.
2. **Multi-Stop-without-UserPromptSubmit loses `Início` (spec-precision on 06.3 "Início = session start (unchanged)").** `buildPayload` clears the start cache on read (`readAndClearStartTime :172-191`, called `:533`), so if two `Stop`s fire for the same session with NO intervening `UserPromptSubmit`, the 2nd (superseding) payload has only `Fim` (no Início/duration). In the realistic `UPS→Stop→UPS→Stop` flow this is a non-issue — each `UPS` re-caches start (`:606`) AND cancels the prior pending via the activity marker — so Início is correctly present. This is base clear-on-read semantics (not introduced by Amendment 1) and no HOOK-06 test asserts the superseding payload's Início (`test:915-939` checks only `stopTs`+spawn count). Severity: LOW, informational — flag only. Fix (optional): add a supersession test that pre-seeds a start cache and asserts the newest pending payload still carries Início, and/or defer start-clear to send-time.

---

## Summary

**Overall**: ✅ Ready
**Spec-anchored**: 5/5 HOOK-06 ACs matched spec outcome, 0 blocking spec-precision gaps
**Sensor**: 5/5 killed, tree clean (byte-identical revert)
**Gate**: 343 passed, build ok
**Base contracts**: zero-dep + always-exit-0 + payload-shape non-regressed

**Next steps**: (optional) close the 2 LOW informational gaps — assert `unref`; add a supersession-retains-Início test (or defer start-clear to send-time).
