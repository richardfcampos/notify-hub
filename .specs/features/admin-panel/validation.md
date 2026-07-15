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

---
---

# Admin Panel — Amendment 1 Validation (dockerized admin: ADMIN-08 + revised ADMIN-01)

**Date**: 2026-07-15
**Spec**: `.specs/features/admin-panel/spec.md` → **Amendment 1** section only (revised ADMIN-01.1/.2 + ADMIN-08.1..4)
**Diff range**: `8bcd627..HEAD` (9da9be5 env-configurable host/paths + apply scoping, 732f843 compose service + Dockerfile stage + invariant test, 9add30a docs)
**Verifier**: independent sub-agent (author ≠ verifier), read-only; 5 sensor mutations in scratch only, each reverted; tracked source tree clean after.
**Scope note**: the base feature (validated above) is NOT re-verified; this section only covers the Amendment 1 surface.

---

## Spec-Anchored Acceptance Criteria (Amendment 1)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + evidence | Result |
| --- | --- | --- | --- |
| ADMIN-01.1: started on host (`npm run admin`) → listen 127.0.0.1 by default; `ADMIN_HOST` may override | default bound addr `127.0.0.1`; override honored | `admin-server.ts:47` `DEFAULT_ADMIN_HOST='127.0.0.1'` + `:61` `host = opts.host ?? DEFAULT_ADMIN_HOST`; env wiring `bin/admin.ts:50` `process.env.ADMIN_HOST ?? '127.0.0.1'`. Tests: `admin-server.e2e.test.ts:210` real bound `.address).toBe('127.0.0.1')`; `:219` override `.toBe('0.0.0.0')` | ✅ PASS |
| ADMIN-01.2: via compose → container listens 0.0.0.0 internally BUT host-side mapping pinned `127.0.0.1:8081:8081`; invariant asserted by a test parsing docker-compose.yml | every host-side port mapping starts `127.0.0.1:` | compose `docker-compose.yml:74` `ADMIN_HOST: 0.0.0.0` + `:69` `- "127.0.0.1:${ADMIN_PORT:-8081}:${ADMIN_PORT:-8081}"`. Test `compose-invariants.test.ts:83-85` `for (port) expect(port.startsWith('127.0.0.1:')).toBe(true)`. Sensor (a) killed. | ✅ PASS |
| ADMIN-08.1: `docker compose up -d` → `admin` service serves panel at http://127.0.0.1:8081, no extra steps | admin container Up; 127.0.0.1:8081 serves | compose `admin` service `docker-compose.yml:60-92`. **Live smoke**: `docker compose ps` → `notify-hub-admin-1 Up [8081]`; `curl http://127.0.0.1:8081/api/status` → `200 {"gateway":{"up":true,"redis":true},...}` | ✅ PASS (live smoke; infra — no unit test) |
| ADMIN-08.2: Save & Apply inside container → recreate gateway via mounted socket using `docker compose up -d --no-build api worker`; never admin itself; project pinned via top-level `name:` | exact args `['compose','up','-d','--no-build','api','worker']`; `name: notify-hub`; socket mounted | args `apply-route.ts:23`. Tests `apply-route.e2e.test.ts:44,58` `expect(commandRunner.calls).toEqual([{...args:[...'api','worker'],...}])` (2 tests). Socket `docker-compose.yml:89` `/var/run/docker.sock:/var/run/docker.sock`. `name` `:12`; test `compose-invariants.test.ts:89-90`. Sensors (b),(d) killed. | ✅ PASS |
| ADMIN-08.3: admin writes .env → survives containerization; project dir bind-mounted (not single-file); env-file path + compose dir env-configurable (`ENV_FILE_PATH`, `COMPOSE_DIR`) | dir-mount `.:/config`; `ENV_FILE_PATH`/`COMPOSE_DIR` read from env & wired to routes | env-config: `bin/admin.ts:51-52` `ENV_FILE_PATH ?? join(cwd,'.env')` / `COMPOSE_DIR ?? cwd`; routes `apply-route.ts:24`, `status-route.ts:24`, `test-send-route.ts:67` use `deps.composeDir ?? process.cwd()`. Tests assert `opts.cwd:'/config'`: `apply-route.e2e.test.ts:58`, `status-route.e2e.test.ts` (composeDir case), `test-send-route.e2e.test.ts` (composeDir case). Dir-mount `docker-compose.yml:84` `- .:/config`, `:80-81` `ENV_FILE_PATH: /config/.env` / `COMPOSE_DIR: /config`. | ✅ PASS (env-config tested; dir-mount structural/code-present + live) |
| ADMIN-08.4: admin → gateway base URL env-configurable (`NOTIFY_GATEWAY_URL`), default localhost on host, `http://api:<port>` in compose | override precedence over derived localhost URL | `gateway-client.ts:23` `baseUrl: baseUrlOverride?.trim() || http://localhost:${port}`; wired `bin/admin.ts:53` `NOTIFY_GATEWAY_URL` → `deps.gatewayBaseUrl` → `buildGatewayContext(cfg, deps.gatewayBaseUrl)` in `status-route.ts:20`, `test-send-route.ts:48`. Tests `gateway-client.test.ts:38` override wins, `:45-46` blank/undefined falls back. compose `docker-compose.yml:82` `NOTIFY_GATEWAY_URL: http://api:${PORT:-8080}`. **Live**: status `gateway.up:true` = containerized admin reached `api` over compose net. Sensor (e) killed. | ✅ PASS |

**Status**: ✅ 6/6 Amendment ACs covered with spec-anchored evidence. ADMIN-08.1 (infra "up brings it up") and the dir-mount half of ADMIN-08.3 are structural compose facts — verified by reading compose + live smoke, not by a unit test (honest record; nature of infra config).

---

## Discrimination Sensor (Amendment 1)

Scratch mutations, one at a time, each reverted via `git checkout --`; targeted test run per mutation.

| # | File:line | Mutation | Expected killer | Killed? |
| - | --------- | -------- | --------------- | ------- |
| a | `docker-compose.yml:69` | ports → `"8081:8081"` (unpinned host side) | compose-invariants ports test | ✅ Killed (`compose-invariants.test.ts:84` `expected false to be true`) |
| b | `docker-compose.yml:12` | removed top-level `name: notify-hub` | compose-invariants project-name test | ✅ Killed (`expected undefined to be 'notify-hub'`) |
| c | `admin-server.ts:47` | `DEFAULT_ADMIN_HOST '127.0.0.1'` → `'0.0.0.0'` | binding default-host test | ✅ Killed (`expected '0.0.0.0' to be '127.0.0.1'`) |
| d | `apply-route.ts:23` | apply args append `'admin'` | apply exact-args tests | ✅ Killed (2 tests: base + composeDir args) |
| e | `gateway-client.ts:23` | drop `baseUrlOverride` (hardcode localhost) | gateway-client override test | ✅ Killed (`expected {…} to deeply equal { baseUrl:'http://api:8080',… }`) |

**Sensor depth**: 5 targeted behavior-level mutations (feature touches host-daemon socket + LAN-binding invariant → elevated).
**Result**: 5/5 killed — PASS ✅. Tracked source tree clean after all reverts (`git status --porcelain docker-compose.yml src/` empty). Pre-existing untracked `.claude/`, `AGENTS.md`, `CLAUDE.md` are unrelated to this amendment.

---

## Gate Check (Amendment 1)

- **Build**: `npm run build` → OK (tsc + admin-ui copy)
- **Full suite**: `npm run test` → **32 files, 193 tests passed, 0 failed, 0 skipped** (matches stated baseline 193; Docker running). Re-run after all sensor reverts: 193 passed (green).
- **Test count before amendment** (validated feature): 185 → **after: 193 — Delta +8** (1 binding override, 2 gateway override/fallback, 1 apply composeDir, 1 status composeDir, 1 test-send composeDir, 2 compose-invariants). All additive; none deleted; no assertions weakened.
- **Live smoke**: admin container Up on 127.0.0.1:8081; `/api/status` 200 with `gateway.up:true, redis:true` (ADMIN-08.1 + ADMIN-08.4 confirmed against the real stack).

---

## Code Quality (Amendment 1 surface)

| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep | ✅ (env-reading stays in `bin/admin.ts`; modules remain env-free; regex compose-parser is deliberately narrow — 2 asserted facts, no YAML-parser dep) |
| Surgical changes, only touched files in scope | ✅ (compose/Dockerfile/.env.example + admin deps/routes/gateway/bin + 1 new test file) |
| Matches existing patterns (Ports & Adapters, injected deps over `process.cwd()` reads) | ✅ (`composeDir`/`gatewayBaseUrl` added to `AdminServerDeps`, wired at the edge) |
| Spec-anchored outcome check (asserted values match spec) | ✅ backend/compose; ADMIN-08.1 + dir-mount = live/structural |
| Every added test maps to an Amendment AC | ✅ no unclaimed tests |

---

## Requirement Traceability Update (Amendment 1)

| Requirement | New Status |
| ----------- | ---------- |
| ADMIN-01 (revised: default 127.0.0.1 host mode + `ADMIN_HOST` override + compose port pinning) | ✅ Verified |
| ADMIN-08 Dockerized admin service (.1 live, .2/.3/.4 tested) | ✅ Verified |

---

## Ranked Gaps / Observations (Amendment 1)

1. **(Minor, coverage) Compose env values not test-asserted.** `compose-invariants.test.ts` asserts only the port pinning + `name`. The `admin` service's `ADMIN_HOST: 0.0.0.0`, `NOTIFY_GATEWAY_URL`, `ENV_FILE_PATH`, `COMPOSE_DIR`, the `.:/config` dir-mount, and the `docker.sock` mount are code-present + live-smoke only — deleting any would not fail the suite (only live smoke would catch it). Acceptable for infra config; a few extra assertions in the same parser test would close it if desired.
2. **(Non-blocking, accepted trade-off) Docker socket mount grants host-daemon control** to the admin container. Explicitly accepted in spec (Portainer pattern) and documented in README/compose comments; in scope only for a personal, localhost-bound tool.
3. **(Non-blocking, documented) `apply` uses `--no-build`** — relies on api/worker images already built out of band; a missing image makes `up` fail rather than rebuild. Documented in `apply-route.ts` header; matches spec's "compose already builds images out of band".

**No production-readiness defects found on the amendment surface**: LAN-unreachable invariant is enforced by the compose mapping AND asserted by a parsing test; apply is scoped away from the admin service (no self-kill mid-request) and asserted; project name pinned (no duplicate stack) and asserted; gateway URL override honored and asserted + live-confirmed.

---

## Amendment 1 Summary

**Overall**: ✅ Ready
**Spec-anchored check**: 6/6 Amendment ACs matched spec outcomes (ADMIN-08.1 + dir-mount half of ADMIN-08.3 = live/structural, honestly recorded).
**Sensor**: 5/5 mutations killed.
**Gate**: 193 passed, build OK, tracked tree clean after reverts.
**Live**: admin container Up on 127.0.0.1:8081; `/api/status` 200, gateway reachable from container.

**Verdict**: PASS
