# Local TTS Channel Validation

**Date**: 2026-07-18
**Spec**: `.specs/features/local-tts-channel/spec.md`
**Diff range**: `a08a297..3559f72` (c8f6db1 player · deddc12 adapter · bd72fd4 admin dropdown · 3559f72 launchd/docs)
**Verifier**: independent sub-agent (author ≠ verifier), read-only over the real tree
**Verdict**: **PASS ✅**

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| L1 Player service (`/voices`, `/speak`, execFile, loopback) | ✅ Done | 19 unit tests |
| L2 `local-tts` adapter + registry | ✅ Done | 5 unit tests |
| L3 Admin voice dropdown (proxy route + UI + fallback) | ✅ Done | 6 e2e + 7 unit |
| L4 launchd + docs + live smoke | ✅ Done | docs/plist; live audio confirmed (log evidence) |

---

## Spec-Anchored Acceptance Criteria

### LTTS-01 — Player service

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| Player starts → binds `127.0.0.1` only | address == `127.0.0.1`, never `0.0.0.0` | `local-tts-server.mjs:219` `listen(port, HOST, …)` · test `local-tts-server.test.mjs:265` `expect(HOST).toBe('127.0.0.1')` + `:273` `expect(server.address().address).toBe(HOST)` | ✅ PASS |
| `GET /voices` → every voice `{name,locale,sample}`, name = exact `say -v` string | `Grandma (Portuguese (Brazil))` etc. verbatim | `local-tts-server.mjs:58` parseVoicesOutput · test `:83` `toEqual({name:'Grandma (Portuguese (Brazil))',…})`; `:193` GET returns 200 + len 6 | ✅ PASS |
| `POST /speak {voice,text}` known voice → `execFile` array args, respond after invoke | fire-and-forget `202` (documented choice) | `local-tts-server.mjs:112` `execFileImpl('say',['-v',voice,body.text])`; `:116` return 202 · test `:117`,`:128`,`:206` | ✅ PASS |
| `text` w/ shell metachars → passed safely, no injection (test-proven) | text lands as ONE literal argv element, zero shell interpretation | test `:117-126` `maliciousText='hello"; rm -rf / #'` → `toEqual([{command:'say',args:['-v','Luciana',maliciousText]}])` + `args).toHaveLength(3)` + `args[2]).toBe(maliciousText)` | ✅ PASS |
| Unknown/empty voice → fall back to default, no loud error | uses `defaultVoice` | `local-tts-server.mjs:108` · test `:138` missing→default, `:146` empty→default, `:154` module DEFAULT_VOICE | ✅ PASS (see nuance below) |

### LTTS-02 — Channel adapter

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| Enabled+configured → POST `{voice, text:"<title>. <message>"}` to `<url>/speak` | exact body + URL | `local-tts-channel.ts:24-34` · test `local-tts-channel.test.ts:30` `toEqual([{…url:'…/speak', body:{voice:'Luciana',text:'Build finished. All tests passed'}}])`; `:49` no-title → `'All tests passed'` | ✅ PASS |
| Player unreachable/errors → adapter throws | throws (retry/isolation) | `local-tts-channel.ts:36-40` · test `:59` non-2xx throws `/local-tts/i`; `:72` ECONNREFUSED propagates | ✅ PASS |
| Registry `requiredConfig: ['LOCAL_TTS_URL','LOCAL_TTS_VOICE']` | exact keys, no maxLength | `local-tts-channel.ts:44-47` + `channel-registry.ts:28` · test `:86` `toEqual([…])` + `:87` maxLength undefined | ✅ PASS |

### LTTS-03 — Admin voice dropdown

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| Configuring local-tts → `LOCAL_TTS_VOICE` renders `<select>` from live list via proxy | select built from `{voices}`; proxy wraps bare array under `{voices,reachable:true}` | UI `admin-channels.js:28-44` special-case → `admin-local-tts.js:57` renderSelect; transform `admin-local-tts.js:29` buildVoiceOptions · route `local-tts-voices-route.ts:50-56` · test UI `admin-local-tts.test.js:30` options w/ locale label; e2e `local-tts-voices-route.e2e.test.ts:35` happy 200 `{voices,reachable:true}` | ✅ PASS |
| Player unreachable → fall back to plain text input pre-filled, non-blocking | genuine text input (not empty select); proxy never 500s → `{voices:[],reachable:false}` | `admin-local-tts.js:29-33` null on unreachable/zero → `:85` renderFallback → `admin-field-row.js:29` masked text input pre-filled `config[key] ?? ''` · test UI `admin-local-tts.test.js:17-28` null cases; e2e `:59`,`:70`,`:81`,`:92` all 200 `{voices:[],reachable:false}`; `:102` missing url → 400 | ✅ PASS (DOM render live-verified; decision logic unit-tested — see nuance) |

**Status**: ✅ All ACs covered, asserted values match spec-defined outcomes.

---

## Injection-Safety (CRITICAL) — Confirmed

- `/speak` and `/voices` both invoke `execFile` with an **array args** signature (`execFileImpl('say', ['-v', voice, body.text])` at `local-tts-server.mjs:112`; `execFileImpl('say', ['-v', '?'])` at `:83`). No string interpolation into a shell; `execFile` (not `exec`) never spawns `/bin/sh`.
- The injection test (`local-tts-server.test.mjs:117-126`) genuinely proves array-arg safety, not "didn't crash": it asserts the exact argv shape AND that the malicious text is argv element **[2]** with `.toHaveLength(3)` — i.e. `hello"; rm -rf / #` is a single literal argument, unsplit and uninterpreted. Sensor (a) confirms: rewriting to a shell string kills this exact test.
- Loopback bind asserted by test, not just inspection: `startServer` test at `:265-274` binds a real ephemeral-port server and asserts `server.address().address === '127.0.0.1'`. Sensor (b) confirms it catches a runtime `0.0.0.0` bind even when the `HOST` constant is untouched.
- Proxy route never 500s: all four failure modes (unreachable, non-2xx, bad JSON, no HttpClient) return `200 {voices:[],reachable:false}` (`local-tts-voices-route.ts:45-59`), each asserted (`e2e:59/70/81/92`). Sensor (d) confirms a re-throw is caught.
- UI fallback is a genuine text input: `buildVoiceOptions` returns `null` for unreachable/zero-voices → `renderFallback` mounts the shared masked `fieldRow` (a real `<input>`), pre-filled with the existing value — not a broken/empty `<select>`.

---

## Discrimination Sensor

Scratch = Edit mutation → run covering test → `git checkout --` revert. Tree confirmed clean (empty `git diff`) after each.

| # | File:line | Mutation | Killed by | Killed? |
| - | --------- | -------- | --------- | ------- |
| a | `local-tts-server.mjs:112` | array args → shell string `` `say -v ${voice} "${text}"` `` | `speak … literal argv array elements` (+4) | ✅ Killed |
| b | `local-tts-server.mjs:219` | `listen(…, HOST)` → `listen(…, '0.0.0.0')` (HOST const untouched) | `startServer binds to 127.0.0.1 only` — `expected '0.0.0.0' to be '127.0.0.1'` | ✅ Killed |
| c | `local-tts-server.mjs:70` | `name.trim()` → `name.trim().split(' (')[0]` (collapse disambiguation) | `exact disambiguated say -v name` + `4 distinct names` | ✅ Killed |
| d | `local-tts-voices-route.ts:57` | `catch { …reachable:false }` → `catch(e){ throw e }` | e2e `unreachable` + `malformed JSON` — `expected 500 to be 200` | ✅ Killed |
| e | `local-tts-channel.ts:25-27` | drop title, `text = notification.message` | `POSTs … combined title+message text` | ✅ Killed |

**Sensor depth**: lightweight×5 (targeted the highest-risk new code: injection surface, trust boundary, disambiguation core, graceful-degrade contract, body shape).
**Result**: 5/5 killed — **PASS ✅**. No surviving mutants.

---

## Live Evidence (read-only, no new sends triggered)

- **Player alive**: `curl -s 127.0.0.1:8082/voices` → real macOS voice list in `[{name,locale,sample}]` shape (e.g. `{"name":"Albert","locale":"en_US",…}`). HTTP 200, exit 0. Confirms the standalone player is running and serving the spec-defined contract with real `say` data.
- **Real sends happened**: `docker compose logs worker` shows **two** complete `local-tts` cycles —
  `channel:"local-tts","msg":"sending notification"` → `…"msg":"notification sent"` (ts `1784349048299`→`…409` and `1784349067318`→`…333`). Matches the implementer's reported live smoke (test-send + real `/notify`). Independent confirmation the audio path executed end-to-end through the worker container to the host player, not just claimed.
- Containers up: `admin`, `api` (healthy), `worker`, `redis`.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep (hardcoded special-case vs generic framework — matches spec YAGNI) | ✅ |
| Surgical changes; matches existing adapter/DI patterns (injected HttpClient/execFile seams) | ✅ |
| Spec-anchored outcome check (asserted values match spec) | ✅ |
| Per-layer coverage: player unit + adapter unit + route e2e (happy+4 error+400) + UI transform unit | ✅ |
| Every test maps to a spec AC / edge case — no unclaimed tests | ✅ |
| Documented guidelines followed (tasks.md Test Coverage Matrix; zero-dep host-client pattern) | ✅ |

**Observed nuances (non-blocking, no fix required):**
1. **AC5 "unknown voice"** — app-level fallback (`local-tts-server.mjs:108`) triggers only on empty/blank/non-string voice. A syntactically-valid-but-nonexistent voice string is passed straight to `say`; macOS `say` itself resolves an unknown voice without a hard error, and the fire-and-forget `.catch` (`:113`) logs (never throws) if it did. Spec intent ("rather than erroring loudly") holds either way. Spec-precision nuance, not a gap.
2. **LTTS-03 DOM render** — `renderLocalTtsVoiceField`/`renderSelect`/`renderFallback` (DOM-heavy) are exercised live, not unit-tested (documented tradeoff in `admin-local-tts.test.js` header). The decision logic (`buildVoiceOptions` → null → fallback) and the proxy contract ARE fully unit/e2e tested, and the fallback reuses the already-tested shared `fieldRow`. Acceptable coverage boundary.

---

## Edge Cases

- [x] Player crash → adapter throws, channel isolated — adapter tests `:59`,`:72` (non-2xx / ECONNREFUSED both surface as throws).
- [x] Very long message → no artificial truncation — registry `maxLength` undefined, asserted `local-tts-channel.test.ts:87`.
- [x] Player restart (reboot) → launchd auto-start — `com.notify-hub.local-tts-player.plist` `RunAtLoad`+`KeepAlive`; `install.md` `launchctl load` + `curl 127.0.0.1:8082/voices` verify. Docs/config (manual), not test-covered by design.

---

## Gate Check

- **Gate command**: `npm run test` (full) + `npm run build`
- **Result**: **387 passed, 0 failed, 0 skipped** (44 files). Build: `tsc -p tsconfig.json` exit 0.
- **Feature tests**: 37 (player 19 + adapter 5 + route e2e 6 + UI 7). Re-ran green after all sensor reverts.
- **Test count**: matches tasks.md baseline (387). No decrease, no weakened assertions.

---

## Requirement Traceability Update

| Requirement | Previous | New |
| ----------- | -------- | --- |
| LTTS-01 Player service | Pending | ✅ Verified |
| LTTS-02 Adapter + registry | Pending | ✅ Verified |
| LTTS-03 Admin dropdown | Pending | ✅ Verified |
| LTTS-04 launchd + docs + live smoke | Pending | ✅ Verified (live audio via log evidence) |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored**: 13/13 ACs matched spec-defined outcomes · 2 non-blocking nuances flagged.
**Sensor**: 5/5 mutations killed.
**Gate**: 387 passed, build ok.
**Live**: player alive on `127.0.0.1:8082`; worker log shows 2 real `local-tts` sends.
**Tree**: clean (empty diff vs HEAD; only pre-existing untracked `.claude/ .mcp.json AGENTS.md CLAUDE.md`).

**What works**: injection-safe array-arg `execFile`; loopback-only bind (runtime-asserted); voice disambiguation by exact `say -v` string; adapter body shape + throw-on-failure; proxy graceful-degrade (never 500) + genuine text-input fallback.

**Issues found**: none blocking.

**Next steps**: none — feature verified. (Nuances 1–2 are informational; no fix tasks.)

---

# Amendment 2 (LTTS-05) Validation — Searchable voice combobox

**Date**: 2026-07-18
**Diff range**: `40ca384..HEAD` (34d7608 `feat(admin): searchable voice combobox for local-tts`)
**Verifier**: independent sub-agent (fresh eyes, read-only; scratch mutations reverted)
**Scope**: LTTS-05 ACs 1–6 ONLY (LTTS-01..04 already validated above — not re-verified)

---

## Spec-Anchored Acceptance Criteria (LTTS-05)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| 1. WHEN operator focuses LOCAL_TTS_VOICE THEN a text input + dropdown panel appears instead of native `<select>` | text `input` + `ul` panel below, no `<select>` | impl `admin-searchable-combobox-dom.js:33-41` (input.combobox-input + ul.combobox-panel), focus wiring `:113-116`; substitution `admin-local-tts.js:76` (createSearchableCombobox replaces old renderSelect) | ✅ impl + live (no unit assertion — DOM-wiring, project no-jsdom convention) |
| 2. WHEN operator types THEN panel filters to voices whose name/locale/sample contains substring (case-insensitive), live | case-insensitive substring across all 3 fields | filter `admin-searchable-combobox.js:19-25`; searchText concat `admin-local-tts.js:44`; wiring `-dom.js:118-125`. Asserts: name+CI `admin-searchable-combobox.test.js:35` `toEqual([VOICES[0]])` (query `'lucIANA'`); locale `:40` (`'en_us'`→VOICES[2]); sample `:45` (`'hello there'`→VOICES[2]); concat `admin-local-tts.test.js:34` | ✅ PASS |
| 3. WHEN operator clicks or keyboard-selects (arrows+Enter) an option THEN its exact `name` becomes the value | field value = voice.name (unchanged adapter contract) | value map `admin-local-tts.js:41` (value=voice.name), `:81-85` (onSelect→config); select `-dom.js:98-104`; Enter `-dom.js:136-141`. Asserts: resolveEnterSelection `admin-searchable-combobox.test.js:97-116`; moveHighlightIndex clamping `:66-95`; exact-name value `admin-local-tts.test.js:34-40` (Grandma full string) | ✅ PASS (helpers unit-tested; DOM select() live-verified) |
| 4. WHEN Escape pressed or click-outside THEN panel closes without changing value | panel hidden, value unchanged (no onSelect) | Escape `-dom.js:142-144`→closePanel(resetLabel); outside `-dom.js:75-79`→docClickHandler→closePanel; closePanel restores input to currentLabel `-dom.js:86-96` (never calls onSelect) | ✅ impl + live (no unit assertion — DOM-wiring convention) |
| 5. No new dependency — plain HTML/CSS/JS, NOT jQuery/Select2 | zero new npm dep, no CDN | `git diff 40ca384..HEAD -- package.json package-lock.json` → **empty**; combobox files import only local `./admin-dom.js`; no `<script src>`/CDN in `admin.html` | ✅ CONFIRMED |
| 6. Player-unreachable text-input fallback (LTTS-03 AC2) unchanged | fallback branch identical to pre-amendment | `renderFallback` `admin-local-tts.js:90-96` untouched by diff (only renderSelect→renderCombobox renamed); combobox replaces ONLY the voices-available branch `:121`, not fallback `:111,:118`. buildVoiceOptions→null for unreachable/zero-voice asserted `admin-local-tts.test.js:18-29` | ✅ CONFIRMED |

**Carry-over (existing value preservation)**: unmatched current voice never silently dropped — appended as manual pre-selected option `admin-local-tts.js:47-49`, asserted `admin-local-tts.test.js:54-63`; combobox shows raw value verbatim when no option matches `-dom.js:26-27`. ✅

**Status**: 6/6 ACs satisfied. AC1 & AC4 are DOM-wiring behaviors covered by implementation + live Docker + code review (no unit assertion) — consistent with the plan's explicit L5 decision (no jsdom/DOM-test dependency in repo). Non-blocking.

---

## No New Dependency

**Confirmed.** `package.json`/`package-lock.json` diff in `40ca384..HEAD` is empty. New code is plain vanilla JS/CSS composing the existing `admin-dom.js` `el`/`clear` helpers. No jQuery, no Select2, no CDN. (Spec LTTS-05 AC5 satisfied by construction.)

---

## Discrimination Sensor

Scratch mutations in working tree, covering test run, `git checkout` revert after each; tree verified clean between each.

| # | File:line | Mutation | Killed? |
| - | --------- | -------- | ------- |
| a | `admin-local-tts.js:44` | searchText → `${voice.name}` only (drop locale+sample) | ✅ Killed — `admin-local-tts.test.js:46` (searchText concat assertion) |
| b | `admin-searchable-combobox.js:20,24` | filter case-sensitive (remove both `.toLowerCase()`) | ✅ Killed — `admin-searchable-combobox.test.js:35` (case-insensitive name match) |
| c | `admin-searchable-combobox.js:22` | empty-query returns `[]` instead of all options | ✅ Killed — `:27` (empty query→all) + `:31` (whitespace→all), 2 tests |
| d | `admin-searchable-combobox.js:19` | in-place `options.sort(...)` (input-array mutation) | ✅ Killed — full suite fails; dedicated no-mutation assertion `:59-62` kills it in isolation (proven) |

**Sensor depth**: lightweight (4 targeted behavior-level mutations). **Result**: 4/4 killed.

**Nuance (informational, non-blocking) — shared-fixture order-coupling in mutation (d)**: `VOICES` is a module-level const shared across all tests in the file. Under an in-place mutation, the earliest `filterOptions` call mutates it, so by the time the dedicated no-mutation test (`:59`) captures its `copy` baseline the array is already reordered — with an *idempotent* sort the second sort is a no-op and that specific test passes; the mutant is instead caught by the order-sensitive name-match test (`:35`). Run in isolation (`-t "does not mutate the input array"`), the no-mutation assertion DOES fail (`:62`), so it is genuinely discriminating. Test-hygiene smell only (freeze fixture per-test or `structuredClone`), not a coverage gap — the suite kills the mutant either way.

---

## Live Check

- Admin container **running**: `notify-hub-admin-1` → `0.0.0.0:8081->8081`.
- Static route serves new modules from root (`static-ui-files.ts` `/*` catch-all):
  - `GET /admin-searchable-combobox.js` → 200, real source served.
  - `GET /admin-searchable-combobox-dom.js` → imports `./admin-searchable-combobox.js` (`:12`) + exports `createSearchableCombobox` (`:24`).
  - `GET /admin-local-tts.js` → imports `./admin-searchable-combobox-dom.js` (`:15`). Import chain intact end-to-end.
- Build: `npm run build` exit 0; `build:copy-admin-ui` is whole-dir `cp -R src/admin/ui/. dist/admin/ui/` (not a per-file allowlist), so all three new files copied deterministically. (Direct `dist/` read blocked by repo's ckignore sandbox; copy verified via exit-0 + whole-directory copy semantics + source-dir file presence.)

---

## Gate Check

- **Command**: `npm run test` (full) + `npm run build`.
- **Result**: **407 passed, 0 failed, 0 skipped** (45 files). Re-ran green after all 4 sensor reverts. Build exit 0.
- **Test count**: 387 (pre-amendment baseline) → **407** (+20 new: `admin-searchable-combobox.test.js` 18 + `admin-local-tts.test.js` +2 searchText). Matches tasks.md L5 claim. No decrease, no weakened assertions.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| No features beyond spec (simple filter, no ranking/fuzzy) | ✅ |
| No new dependency / abstraction bloat | ✅ (pure/DOM split mirrors admin-field-row.js precedent; each file <200 lines) |
| Only touched files required for LTTS-05 | ✅ (combobox ×3, admin-local-tts +test, css) |
| Matches existing patterns/style (vanilla el/clear, dark-theme tokens) | ✅ |
| Tests map to ACs, non-shallow | ✅ (AC2/3/5/6 direct; AC1/4 DOM-live by documented convention) |
| Spec-anchored outcome check (asserted values match spec) | ✅ |
| No unclaimed tests | ✅ |

---

## Requirement Traceability Update

| Requirement | Previous | New |
| ----------- | -------- | --- |
| LTTS-05 Searchable voice combobox (no new dependency) | Pending | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored**: 6/6 ACs satisfied (AC2/3/5/6 automated; AC1/4 impl + live + review per no-jsdom convention).
**No new dependency**: confirmed (empty package.json/lock diff).
**Sensor**: 4/4 mutations killed.
**Gate**: 407 passed, build ok.
**Live**: admin container serves all 3 new modules; import chain intact.
**Tree**: clean (empty diff vs HEAD; only pre-existing untracked `.claude/ .mcp.json AGENTS.md CLAUDE.md`).

**What works**: case-insensitive substring filter across name+locale+sample; no-new-dependency vanilla combobox; existing/unmatched voice value preserved (never silently dropped); player-unreachable plain-text fallback unchanged (combobox replaces only the voices-available branch); no input-array mutation.

**Issues found**: none blocking. One informational test-hygiene nuance (shared-fixture order-coupling in the no-mutation test — mutant still killed by suite).

**Next steps**: none — LTTS-05 verified.
