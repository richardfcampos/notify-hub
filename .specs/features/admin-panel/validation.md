# Admin Panel Validation

**Date**: 2026-07-15
**Spec**: `.specs/features/admin-panel/spec.md`
**Diff range**: `cd9c39c..HEAD` (54a633e, dac11ce, 418bb32, 0b22e2f, dd224b5 + 2 docs commits)
**Verifier**: independent sub-agent (author ≠ verifier), read-only; mutations in scratch only, reverted

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| A1 env-file store + config model | ✅ Done | unit-tested |
| A2 admin server + config routes | ✅ Done | e2e-tested |
| A3 apply/status/test-send routes | ✅ Done | e2e/unit-tested |
| A4 dark dashboard UI | ✅ Done | code-present only (no UI unit tests, per matrix) |
| A5 entrypoint + script + docs | ✅ Done | build gate green |

---

## Spec-Anchored Acceptance Criteria

| Criterion (WHEN X THEN Y) | Spec outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| ADMIN-01: server starts → listens 127.0.0.1 only, never 0.0.0.0 | bound addr `127.0.0.1` | `admin-server.e2e.test.ts:210` — `expect(...address.address...).toBe('127.0.0.1')` | ✅ PASS |
| ADMIN-01: static UI served / 404 / 403-traversal / no-route-when-omitted | 200 html / 404 / 403 / 404 | `admin-server.e2e.test.ts:165,177,187,196` | ✅ PASS |
| ADMIN-02: panel loads → one card per channel w/ enabled + required fields from .env | seeded .env reflected | `admin-server.e2e.test.ts:53` — `expect(res.json()).toEqual({...ntfy enabled+values...})` | ✅ PASS |
| ADMIN-02: no .env yet → empty model | all channels disabled/blank | `admin-server.e2e.test.ts:70`; `admin-config.test.ts:23` | ✅ PASS |
| ADMIN-03.AC4: enabled channel missing key → reject naming channel+key, nothing written | 400 + exact msg; content unchanged; 0 backups | `admin-server.e2e.test.ts:96-99`; `admin-validation.test.ts:34` | ✅ PASS |
| ADMIN-03 (profiles AC3): default channel not enabled → reject naming it, nothing written | 400 + exact msg; nothing written | `admin-server.e2e.test.ts:112-115`; `admin-validation.test.ts:56` | ✅ PASS |
| ADMIN-03: valid → backup then atomic round-trippable write | backup path returned; GET re-parses to saved cfg | `admin-server.e2e.test.ts:136-144`; `env-file-store.test.ts:30-70` | ✅ PASS |
| ADMIN-03 edge: unknown/extra keys preserved verbatim | PORT/REDIS_URL/RETRY_*/custom survive | `admin-config.test.ts:49-62,101` | ✅ PASS |
| ADMIN-04.AC1: apply → run `docker compose up -d`, report outcome | 200 + stdout; exact args+cwd | `apply-route.e2e.test.ts:38-41` — `expect(commandRunner.calls).toEqual([{cmd:'docker',args:['compose','up','-d'],opts:{cwd}}])` | ✅ PASS |
| ADMIN-04.AC3: compose fails → show command error output | 500 + stderr | `apply-route.e2e.test.ts:51-52` | ✅ PASS |
| ADMIN-04.AC2: validation fail → no restart | PUT/apply are separate endpoints; UI runs apply only after save.ok | `admin-save-flow.js:34-42` (code-present, no server test) | ⚠️ Code-present only |
| ADMIN-05.AC1: test-send → POST /notify to only that channel, first profile token | exact URL+Bearer+channels:[ch] | `test-send-route.e2e.test.ts:71-76`; `gateway-client.test.ts:87-92` | ✅ PASS |
| ADMIN-05.AC2: outcome in logs → show real result (sent / failure reason) | `{ok:false, detail:'CallMeBot: invalid apikey'}` | `test-send-route.e2e.test.ts:97` | ✅ PASS |
| ADMIN-05.AC3: gateway down → report clearly, no hang | `{ok:false, detail:'gateway unreachable: ECONNREFUSED'}`; bounded poll (3 calls) | `test-send-route.e2e.test.ts:108,121` | ✅ PASS |
| ADMIN-06.AC1: status → health + channels + last ~20 worker lines | up+redis+channels+parsed deliveries; 20-cap | `status-route.e2e.test.ts:59-64`; `worker-log-parser.test.ts:59-61` | ✅ PASS |
| ADMIN-06.AC2: gateway unreachable → down without breaking rest | `gateway:{up:false}`, deliveries still returned | `status-route.e2e.test.ts:86-91`; `gateway-client.test.ts:65` | ✅ PASS |
| ADMIN-07: secret fields masked by default + reveal on click + re-mask | `type='password'`; eye toggles text↔password | `admin-channels.js:27,44-49`; `admin-profiles.js:47,76-81` | ⚠️ Code-present only |
| ADMIN-07: track unsaved changes, enable Save & Apply | `markEdited()` on every edit; dirty drives sticky bar | `admin-state.js:45-48`; `admin-save-flow.js:77` | ⚠️ Code-present only |

**Status**: ✅ All backend ACs covered with spec-anchored assertions. UI ACs (ADMIN-07, ADMIN-04.AC2 orchestration) verified by reading code — no UI unit tests exist by the test-coverage matrix's explicit design (row 4: "none — Build gate + live smoke"). Recorded honestly as code-present-only, not as tested.

---

## Discrimination Sensor

| # | File:line | Mutation | Killed? |
| - | --------- | -------- | ------- |
| a | `admin-server.ts:42` | `ADMIN_HOST '127.0.0.1'` → `'0.0.0.0'` | ✅ Killed (binding test: expected '0.0.0.0' to be '127.0.0.1') |
| b | `admin-validation.ts:24` | missing-key check `if(!value||...)` → `if(false)` | ✅ Killed (3 tests: validation unit + 400-naming e2e) |
| c | `config-routes.ts:53` | `if(!validation.ok)` → `if(false)` (write on invalid) | ✅ Killed (both "writes nothing" assertions) |
| d | `admin-config.ts:141` | serialize skips `extraKeys` (iterate `[]`) | ✅ Killed (round-trip + preservation) |
| e | `test-send-route.ts:73` | `ok: match.ok` → `ok: true` | ✅ Killed (failure-detail test) |

**Sensor depth**: 5 manual behavior-level mutations (feature handles secrets/apply → treated as elevated).
**Result**: 5/5 killed — PASS ✅. Tree clean after all reverts (`git status --porcelain src/admin src/bin` empty).

---

## Security Spot-Checks

| Check | Evidence | Result |
| ----- | -------- | ------ |
| Admin server never logs secret values | Fastify `logger:false` (`admin-server.ts:23`); grep of routes/services finds no logging of config/values; only stderr diagnostics in `bin/admin.ts` (URL, signals, errors — no secrets) | ✅ Pass |
| Reveal toggle logs no secret | Reveal is client-side only (`type` flip, no server round trip); server has no secret logging | ✅ Pass |
| Static path-traversal guard rejects `../` | `static-ui-files.ts:35` `filePath!==root && !startsWith(root+sep)`; genuinely tested — `admin-server.e2e.test.ts:180-188` asserts 403 for `/..%2f..%2fpackage.json` | ✅ Pass |
| CommandRunner uses execFile, no shell interpolation | `command-runner.ts:31` `execFile` (args array); `command-runner.test.ts:32-39` passes `$(...)`/`;`/`|` untouched | ✅ Pass |
| PUT /api/config can't write outside .env path | `NodeEnvFileStore` path fixed at construction (`bin/admin.ts:34` `join(repoRoot,'.env')`); PUT body carries config content only, never a path | ✅ Pass |
| GET returns secrets in full over wire | Intended per spec (localhost-only trust, "podendo mostrar as keys"); not a leak | ✅ By design |

---

## Edge Cases

- [x] `.env` missing → empty model, save creates it (`admin-config.test.ts:20`; write() creates file via tmp+rename)
- [x] Unknown/extra keys preserved verbatim (`admin-config.test.ts:33`; sensor d killed)
- [~] Two saves race → last-write-wins — by design (single-user tool); no dedicated test. Not a precise testable outcome; acceptable per spec. ⚠️ coverage note
- [x] Reveal toggle → no secret logged by admin server (logger off; client-side reveal; grep clean)

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep | ✅ (hand-rolled static serving justified over plugin; Ports & Adapters matches repo) |
| Surgical changes, only touched files in scope | ✅ (all new under `src/admin/**`, `src/bin/admin.ts`, `test/helpers/fakes.ts` additions) |
| Matches existing patterns (ports, fakes, fail-fast msg style) | ✅ |
| Spec-anchored outcome check (asserted values match spec) | ✅ backend; ⚠️ UI code-present-only (matrix design) |
| Per-layer coverage: domain 1:1 ACs; routes happy+edge+error | ✅ (57 admin test cases) |
| Every test maps to a spec AC / edge case | ✅ no unclaimed tests |
| Documented guidelines followed | ✅ `tasks.md` Test Coverage Matrix |

---

## Gate Check

- **Build**: `npm run build` → OK (tsc + admin-ui copy)
- **Full suite**: `npm run test` → **31 files, 185 tests passed, 0 failed, 0 skipped**
- **Test count before feature** (at `cd9c39c`): 128
- **After feature**: 185 — **Delta: +57 admin test cases** (all additive; none deleted, no assertions weakened)
- Re-run after all mutations reverted: 185 passed (green)

---

## Requirement Traceability Update

| Requirement | New Status |
| ----------- | ---------- |
| ADMIN-01 Localhost-only server + static UI | ✅ Verified |
| ADMIN-02 GET config | ✅ Verified |
| ADMIN-03 Save validation + backup + atomic + unknown-key preservation | ✅ Verified |
| ADMIN-04 Apply via docker compose | ✅ Verified (AC2 no-restart = UI orchestration, code-present) |
| ADMIN-05 Per-channel test send real outcome | ✅ Verified |
| ADMIN-06 Status | ✅ Verified |
| ADMIN-07 Dark dashboard UI | ✅ Verified by code reading (no UI unit tests by matrix design) |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 15/15 backend ACs matched spec-defined outcomes; 3 UI/orchestration criteria code-present-only (no UI unit tests — matrix's explicit design, not a regression).
**Sensor**: 5/5 mutations killed.
**Gate**: 185 passed, build OK. Tree clean after mutations.

**What works**: Localhost-only binding (asserted on real bound address), fail-fast save validation that writes nothing on failure, atomic backup+write, unknown-key round-trip preservation, execFile (no shell) compose apply, real-outcome test-send from worker logs, graceful gateway-down degradation, path-traversal guard.

**Non-blocking notes**:
1. UI behavior (ADMIN-07 mask/reveal, unsaved tracking; ADMIN-04.AC2 no-restart-on-invalid) has no automated coverage — verified by reading. Consistent with the coverage matrix; a live smoke or a small DOM test would close the gap if desired.
2. Two-saves-race edge case is last-write-wins by design (single-user); untested — acceptable.
3. `apply`/`status`/`test-send` shell out with `cwd: process.cwd()` (not the resolved `repoRoot`); relies on admin being launched from repo root (npm script does). Minor coupling, not a spec violation.

**Verdict**: PASS
