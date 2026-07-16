# db-channels Validation

**Date**: 2026-07-16
**Spec**: `.specs/features/db-channels/spec.md`
**Diff range**: `de7553f..9a313eb` (Phases 1-4: sqlite bootstrap/repos/seed → gateway rewire → admin rewire → docker/migration)
**Verifier**: independent sub-agent (author ≠ verifier), read-only over the real tree; sensor mutations run in scratch and reverted via `git checkout` immediately.

---

## Verdict: PASS ✅ (iteration 2 — the surviving mutant now dies; gap 2 closed)

> **Superseded by Iteration 2 (2026-07-16).** Iteration 1's single surviving mutant (dispatch profile-default fallback, mutation b) is now KILLED by 2 discriminating tests added in test-only commit `06e703e`, and Minor gap 2 (throwing DB read during delivery) is closed by a new propagate-for-retry delivery test. All 6 sensor mutations now die; gate is green (251/251, build ok, tree clean). See **## Iteration 2** at the bottom for evidence. The Iteration 1 verdict below is retained for history.

### Iteration 1 verdict (historical): FAIL ❌ (1 test-discrimination gap; implementation correct + live-proven)

The implementation is functionally correct and live-verified. Gate is green (248/248) and 5 of 6 discrimination mutations were killed. **One mutation survived (dispatch profile-default fallback)** — the suite cannot distinguish "route to the profile's defaults" from "route to ALL enabled instances" on the no-`channels` path. That path is the spec's #1 success criterion (per-profile isolation / cross-profile routing). Because a surviving mutant means the feature's headline behavior has no regression guard, the strict sensor discipline renders FAIL pending one test-strengthening fix. **Production risk is low**: the shipping code IS correct (uses `profileRepo.get(job.profileId).defaultChannels`) and isolation was proven against the live stack — this is a missing test, not a code bug.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| D1 SQLite bootstrap + schema | ✅ Done | WAL/busy_timeout/FK + idempotent schema, all asserted |
| D2 Channel + Profile repos | ✅ Done | Temp-file SQLite round-trips, cascade, subset-prune |
| D3 Seed-from-env | ✅ Done | Enabled→instance, missing-cred→disabled, idempotent |
| D4 Type-keyed registry + build | ✅ Done | `build-instance.ts` unknown-type throw + decorators |
| D5 Delivery read-through | ✅ Done | Per-delivery load; hot-reload proven (unit + integration) |
| D6 Dispatch ∩ enabled | ⚠️ Partial | Code correct; fallback path lacks a discriminating test (see gap) |
| D7 API rewire to DB | ✅ Done | token→profile, /notify 202/400/401/503, /channels shape |
| D8 Container + entrypoints | ✅ Done | Integration fan-out over real SQLite green |
| D9 Admin API CRUD | ✅ Done | Write-time validation, validate-all-then-write, test-send by id |
| D10 Admin UI helpers | ✅ Done | Pure helpers unit-tested; DOM behavior live-smoke only |
| D11 Docker/docs/migration | ✅ Done | Infra: build gate + live smoke (no automated test) |

---

## Spec-Anchored Acceptance Criteria

### DBCH-01 — SQLite bootstrap + schema + migrations
| Criterion | Spec outcome | file:line + assertion | Result |
| --- | --- | --- | --- |
| DB file absent → created with schema | file + parent dirs created | `src/db/database.test.ts:24` — `expect(existsSync(dbPath)).toBe(true)` | ✅ |
| WAL journaling | `wal` | `src/db/database.test.ts:48` — `expect(mode).toBe('wal')` | ✅ |
| Busy timeout set | 5000ms | `src/db/database.test.ts:66` — `expect(timeout).toBe(5000)` | ✅ |
| FK enforcement (for cascade) | on | `src/db/database.test.ts:57` — `expect(enforced).toBe(1)` | ✅ |
| Idempotent schema (re-open) | tables + data survive | `src/db/database.test.ts:33,72` — `expect(tableNames).toEqual([...])`, row survives | ✅ |

### DBCH-02 — Channel + Profile repositories
| Criterion | Spec outcome | file:line + assertion | Result |
| --- | --- | --- | --- |
| Config JSON + enabled round-trip | exact instance back | `src/db/sqlite-repositories.test.ts:58` — `expect(get('acme-slack')).toEqual({...})` | ✅ |
| Multiple same-type instances independent | own config each | `:73,74` — `expect(...SLACK_WEBHOOK_URL).toBe('a'|'b')` | ✅ |
| Upsert in place (no dup row) | len 1, updated | `:81` — `expect(list()).toHaveLength(1)` | ✅ |
| listEnabled filters | only enabled | `:89` — `expect(listEnabled()...).toEqual(['on'])` | ✅ |
| resolveByToken | profile or null | `:125-128` — token→id, unknown/empty→null | ✅ |
| Profile default is subset (prune non-existent) | ghost pruned | `:152` — `expect(defaultChannels).toEqual(['acme-slack'])` | ✅ |
| Delete cascades (profile + channel) | join rows gone | `:169,182` — cascade asserted both directions | ✅ |

### DBCH-03 — Seed-from-.env-if-empty
| Criterion | Spec outcome | file:line + assertion | Result |
| --- | --- | --- | --- |
| Empty DB + legacy env → seed instance named by type | id=type, Title label | `src/db/seed-from-env.test.ts:46` — `expect(list()).toEqual([{id:'ntfy',...}])` | ✅ |
| Missing required cred → disabled instance | enabled:false | `:77` — `expect(get('slack')).toMatchObject({enabled:false})` | ✅ |
| TOKENS → profiles w/ defaults filtered to created | slug id, subset | `:96` — `expect(list()).toEqual([{id:'richard-campos',defaultChannels:['ntfy']}])` | ✅ |
| Populated DB → NOT re-seed (idempotent) | seeded=false, untouched | `:122` — `expect(seeded).toBe(false)` + lengths | ✅ |

### DBCH-04 — Type-keyed registry + per-instance build
| Criterion | Spec outcome | file:line + assertion | Result |
| --- | --- | --- | --- |
| Build adapter from instance config; unknown type throws naming instance | error names type+id | `src/channels/build-instance.test.ts` (unit) + `build-instance.ts:37` throw | ✅ |
| Decorators (truncate→log w/ instance id) | wrapped | `build-instance.ts:44` + log-label=instance id (fan-out per-instance logs) | ✅ |

### DBCH-05 — Delivery read-through (hot-reload) ⭐
| Criterion | Spec outcome | file:line + assertion | Result |
| --- | --- | --- | --- |
| Next send uses NEW config, no restart | 2nd send hits new URL | `src/delivery/delivery-service.test.ts:132` — `expect(urls).toEqual(['.../hook','.../CHANGED'])`; `test/integration/fan-out.test.ts:159` — real SQLite `['/v1','/v2']` | ✅ (killed by mutation a) |
| Load type+config at delivery time, build, send | ok:true, instance id | `delivery-service.test.ts:57-61` — channel/ok/attempts + http url | ✅ |

### DBCH-06 — Dispatch resolves instance ids ∩ enabled
| Criterion | Spec outcome | file:line + assertion | Result |
| --- | --- | --- | --- |
| `channels` specified → ∩ enabled, disabled excluded | ['ntfy'] | `src/dispatch/dispatch-service.test.ts:101` — `expect(recorded...).toEqual(['ntfy'])` | ✅ |
| Omitted → profile defaults ∩ enabled | ['ntfy','telegram'] | `dispatch-service.test.ts:117` — `expect(recorded...).toEqual(['ntfy','telegram'])` | ⚠️ **DISCRIMINATION GAP** — in every fallback test the profile defaults == the enabled set, so "all enabled" is indistinguishable (mutation b survived). Per-profile isolation (Success Criterion 1) is not guarded by a killing test. |
| Empty resolved set → no-op + warn | 0 enqueued, warn | `dispatch-service.test.ts:129-131` — `expect(recorded).toEqual([])` + warn | ✅ |
| Same-type fan-out (2 slacks both routed) | both jobs | `dispatch-service.test.ts:147`, `fan-out.test.ts:135` — both instances get a delivery | ✅ |

### DBCH-07 — API: token→profile from DB, /notify + /channels by id
| Criterion | Spec outcome | file:line + assertion | Result |
| --- | --- | --- | --- |
| token→profile (DB), enqueue right DispatchJob | 202 + profileId | `src/api/server.e2e.test.ts:83-93` — 202, profileId 'phone', requestedChannels | ✅ |
| Unknown instance id in `channels` | 400 naming it, nothing enqueued | `server.e2e.test.ts:166-168` — `expect(status).toBe(400)`+`error contains 'bogus'`, dispatched len 0 | ✅ |
| Existing-but-disabled id (existence≠enablement) | 202 (dispatcher decides) | `server.e2e.test.ts:184` — `expect(status).toBe(202)` | ✅ |
| Missing token / unknown token | 401, nothing enqueued | `server.e2e.test.ts:121,136` — 401 + dispatched len 0 | ✅ |
| Queue down | 503 | `server.e2e.test.ts:209` — `expect(status).toBe(503)` | ✅ |
| /channels shape {channels[{id,label,type,enabled}],defaultChannels} | exact | `server.e2e.test.ts:269` — deep-equal; **live-confirmed** GET /channels | ✅ |

### DBCH-08 — Admin API CRUD + write-time validation + no compose-apply
| Criterion | Spec outcome | file:line + assertion | Result |
| --- | --- | --- | --- |
| GET /api/config reflects repos | channels+profiles | `src/admin/routes/config-routes.e2e.test.ts:54` — deep-equal | ✅ |
| PUT valid → upsert + delete diff | persisted / removed | `:87,103,121` — list reflects upsert & delete | ✅ |
| Invalid slug id → 400 naming it, writes nothing | 400 + list [] | `:145-146` — `error contains '"Not A Slug"'`, `list()==[]` | ✅ |
| Duplicate id → 400, nothing | `Duplicate channel id "dup"` | `:160-161` | ✅ |
| Unknown type → 400, nothing | names type | `:175-176` | ✅ |
| Enabled missing cred → 400 naming instance+key, nothing | exact msg | `:190-191` — `'...missing required config "SLACK_WEBHOOK_URL"'` | ✅ |
| Profile ref not-exist / disabled → 400, nothing | exact msg | `:208,227` | ✅ |
| Duplicate token → 400, nothing | names profile | `:245` | ✅ |
| Rejected write leaves pre-existing exactly | no partial apply | `:262-263` — repos unchanged | ✅ (killed by mutation c) |
| test-send by instance id → real gateway request | channels:[id], outcome | `src/admin/routes/test-send-route.e2e.test.ts:68-73` — exact body incl `channels:['acme-ntfy']`; unknown/disabled→400 (`:143,153`) | ✅ |
| No `/api/apply` step | route removed | `apply-route.ts`+test deleted in diff | ✅ (absence) |

### DBCH-09 — Admin UI: instance mgmt + per-profile selection, live save
| Criterion | Spec outcome | file:line + assertion | Result |
| --- | --- | --- | --- |
| Slug normalize + validate (mirror backend regex) | slugify⊆isValid | `src/admin/ui/admin-instance-id.test.js:30,43-52` | ✅ |
| Inline completeness warning (missing key) | blank/ws = missing | `src/admin/ui/admin-channel-completeness.test.js:24,28` | ✅ |
| PUT body assembly (trim stray keys) | only required keys | `src/admin/ui/admin-config-payload.test.js:26` — `expect(config).toEqual({NTFY_URL,NTFY_TOPIC})` | ✅ |
| Prune default on disable/delete (subset invariant, UI side) | deselected | `src/admin/ui/admin-defaults.test.js:35,45,76` | ✅ |
| Add-channel type picker not hardcoded | from registry | `src/admin/routes/channel-types-route.e2e.test.ts` (exists) | ✅ |
| List/live-save/chips DOM behavior | live, no restart | not unit-tested (extractable-logic-only scope); **live-smoke verified** | ⚠️ Live-only |

### DBCH-10 — Docker volume + docs + migration + smoke
| Criterion | Spec outcome | file:line + assertion | Result |
| --- | --- | --- | --- |
| Named volume + DB_PATH on api/worker/admin, README, .env.example | single shared WAL file | `docker-compose.yml`, `Dockerfile`, `README.md`, `.env.example` (diff) — no automated test | ⚠️ Infra/smoke-only |
| Legacy .env migrates on first boot, zero steps | seeded instances live | **This validation confirms**: live GET /channels → 5 seeded instances (ntfy/email/slack/telegram/discord all enabled) + profile default `["ntfy"]` | ✅ Smoke |

---

## Edge Cases
- [x] Non-safe slug → reject (backend `config-routes.e2e:145`) or normalize (UI `admin-instance-id.test.js`). Handled both sides.
- [x] Two same-type instances keep own config; deleting one never affects the other — `sqlite-repositories.test.ts:67` + cascade `:172` + fan-out same-type `:135`.
- [x] Delivery to deleted/disabled instance → logged no-op skip, others unaffected — `delivery-service.test.ts:64,87` (killed by mutation f) + fan-out isolation `:135-140`.
- [~] DB locked/busy → WAL + busy timeout applied (`database.test.ts:48,66`). **"A failed read errors THAT send without crashing the process" is not directly asserted** — send-failure re-throw for BullMQ retry is tested (`delivery-service.test.ts:157`), but a repository read throwing mid-delivery has no explicit test. Minor spec-precision gap (architecturally isolated per-job).
- [x] Migrating a .env channel with missing creds → seeds disabled — `seed-from-env.test.ts:77`.

---

## Discrimination Sensor

| # | File:line | Mutation | Killed? |
| - | --------- | -------- | ------- |
| a | `src/delivery/delivery-service.ts:38` | Cache instance at first load (`_cached ??=`) instead of per-delivery read — defeat hot-reload | ✅ Killed (delivery hot-reload + fan-out hot-reload + fan-out isolation, 3 tests) |
| b | `src/dispatch/dispatch-service.ts:68-70` | Fallback source = `channelRepo.listEnabled()` ids instead of `profileRepo.get(profileId).defaultChannels` — route to ALL enabled | ❌ **SURVIVED** (full suite 248/0) |
| c | `src/admin/routes/config-routes.ts:60` | Upsert channels BEFORE validation (persist on invalid) | ✅ Killed (5 "writes nothing" tests) |
| d | `src/db/seed-from-env.ts:44` | `length > 0` → `length < 0` — seed even when DB non-empty | ✅ Killed (idempotency test) |
| e | `src/db/seed-from-env.ts:56` | `enabled: hasAllRequired(...)` → `enabled: true` — seed missing-cred ENABLED | ✅ Killed (disabled-seed test) |
| f | `src/delivery/delivery-service.ts:45` | Disabled/missing instance THROWS instead of logged skip → BullMQ retry loop | ✅ Killed (disabled + deleted skip tests) |

**Sensor depth**: P0-level (6 targeted behavior mutations across the highest-risk new code).
**Result**: 6 injected, 5 killed, 1 survived.
**Tree clean after mutations**: yes — `git diff --stat` empty; only pre-existing untracked `.claude/ AGENTS.md CLAUDE.md`.

### Surviving mutant b — root cause & fix
- **Root cause (test gap, not code bug)**: Every test that exercises the no-`channels` fallback path uses a profile whose `defaultChannels` equals the full enabled set (`dispatch-service.test.ts:106` enabled={ntfy,telegram}==default; `fan-out.test.ts:116` the 3 defaults are the only 3 enabled instances). So "resolve profile defaults ∩ enabled" and "resolve all enabled" yield identical output — nothing can catch a regression that ignores the profile and blasts every enabled instance. That regression is exactly a cross-profile data leak (Acme's notification landing on Globex's Slack), the spec's headline promise.
- **Fix task (test-only, blocker-for-done)**: Add a `DispatchService.handleDispatch` test with ≥2 enabled instances where the dispatching profile's `defaultChannels` is a STRICT SUBSET, on the fallback path (no `requestedChannels`), asserting only the profile's own instances get a delivery job. Ideally two profiles (Acme→[acme-slack], Globex→[globex-slack]) both dispatched, each landing only on its own — directly encoding Success Criterion 1. Re-run mutation b to confirm it now dies.
- **Priority**: Major (guards the feature's #1 success criterion). Code change: none.

---

## Code Quality
| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep | ✅ Ports & Adapters mirrors existing repo style; deletions (channel-builder, token-resolver, env-file-store, apply-route) match "update existing, no enhanced files" |
| Surgical changes / matches patterns | ✅ Repos behind ports, fakes mirror SQLite contract, decorators reused |
| Spec-anchored outcome check | ✅ Asserted values match spec outcomes (exact error strings, status codes, shapes) |
| Per-layer coverage (domain 1:1; routes happy+edge+error) | ⚠️ Strong except dispatch fallback discrimination (gap b) |
| Every test maps to a spec req | ✅ No unclaimed tests observed |
| Documented guidelines | none in-repo for testing — strong defaults applied (temp-file SQLite over mocks, e2e via `app.inject`) |

---

## Gate Check
- **Build**: `npm run build` — ✅ tsc + copy-admin-ui, no errors.
- **Full**: `npm run test` (vitest) — **248 passed / 0 failed / 0 skipped**, 37 files, 5.06s.
- **Post-mutation re-run**: 248/0 (tree restored). No test-count decrease vs the stated 248 baseline.
- Note: the full suite completed in ~5s; the Docker/testcontainers path (if reused a running Redis) still yielded 248 with nothing skipped — no silent skips detected.

---

## Live Sanity (read-only, real stack)
- `GET http://localhost:8080/health` → **200** `{"status":"ok","redis":true}`.
- Token extracted from `.env` TOKENS into a shell var (never printed; length 48). `GET /channels` → **200** with the new instance shape: 5 instances `[ntfy,email,slack,telegram,discord]` each `{id,label,type,enabled:true}` + `defaultChannels:["ntfy"]`. Confirms auto-migration seeded the legacy `.env` and the DBCH-07 response contract. No live data mutated.

---

## Requirement Traceability Update
| Requirement | New Status |
| ----------- | ---------- |
| DBCH-01 | ✅ Verified |
| DBCH-02 | ✅ Verified |
| DBCH-03 | ✅ Verified |
| DBCH-04 | ✅ Verified |
| DBCH-05 | ✅ Verified (hot-reload sensor-proven) |
| DBCH-06 | ⚠️ Needs test (fallback discrimination gap) |
| DBCH-07 | ✅ Verified |
| DBCH-08 | ✅ Verified |
| DBCH-09 | ✅ Verified (DOM live-only) |
| DBCH-10 | ✅ Verified (infra smoke) |

---

## Summary
**Overall**: ⚠️ Not Ready — one Major test-strengthening fix, then re-verify.

**Spec-anchored**: DBCH-01..10 ACs all covered by evidence; 1 discrimination gap (DBCH-06 fallback) + 2 minor spec-precision notes (edge-case 4 "failed read errors one send"; DBCH-09/10 DOM+infra live-only, acceptable per scope).
**Sensor**: 6 injected, 5 killed, 1 survived.
**Gate**: 248 passed, build ok.
**Live**: health ok; /channels shape + auto-migration confirmed.

**Ranked gaps**:
1. **[Major]** DBCH-06 fallback path has no discriminating test — dispatch "profile defaults ∩ enabled" is indistinguishable from "all enabled" (mutation b survived). Risk: cross-profile routing/data leak, the spec's #1 success criterion. Fix = add a strict-subset (ideally two-profile isolation) dispatch test. Code unchanged.
2. **[Minor]** Edge-case 4 "a failed DB read errors that send without crashing the process" not directly asserted. Fix = one delivery/worker test with a throwing repo read.

**Next steps**: Route gap 1 (and optionally 2) as test-only fix task(s) to an implementer; re-run mutation b to confirm the survivor now dies; then flip DBCH-06 to Verified.

---

## Iteration 2

**Date**: 2026-07-16
**Verifier**: independent sub-agent (re-verify; verify-don't-trust). Bounded fix→re-verify loop, iteration 2.
**Under test**: `main` at `06e703e` (tree clean; pre-existing untracked `.claude/ AGENTS.md CLAUDE.md`). All sensor mutations run in scratch and reverted via `git checkout`; tree clean at end.

### Fix under review: `06e703e` is TEST-ONLY — confirmed
`git show --stat 06e703e` → only two files, both tests, +129/-0:
- `src/dispatch/dispatch-service.test.ts` (+61) — 2 new discriminating dispatch tests.
- `src/delivery/delivery-service.test.ts` (+68) — 1 new throwing-read delivery test (+ `ThrowingChannelRepository` helper).

`git show 06e703e --name-only | grep -v '\.test\.(ts|js)$'` → empty. **No production code touched.** The shipping `dispatch-service.ts` / `delivery-service.ts` are byte-identical to iteration 1 (still correct: `profileRepo.get(job.profileId)?.defaultChannels`, read at delivery time outside the send try/catch).

### Mutation b re-run — now KILLED
Re-injected EXACTLY as iteration 1 (`src/dispatch/dispatch-service.ts:68-70`): fallback source `= this.deps.channelRepo.listEnabled().map((c) => c.id)` instead of `this.deps.profileRepo?.get(job.profileId)?.defaultChannels ?? []` (route to ALL enabled).

- `vitest run src/dispatch/dispatch-service.test.ts` → **8 passed / 2 failed**.
- `vitest run src` (full unit) → **226 passed / 2 failed** — exactly the same 2 tests, no collateral.

Failing (killing) tests — both new in `06e703e`:
1. `DispatchService.handleDispatch › fallback routes ONLY to the profile default subset, not every enabled instance (discriminates against a "route to all enabled" regression)` — `dispatch-service.test.ts:173` (`expected length 1, got 3`). Enabled set {acme-slack, globex-slack, ntfy} is a strict superset of profile `acme`'s single default `[acme-slack]`; mutant enqueues all 3.
2. `DispatchService.handleDispatch › isolates dispatch across profiles: each profile fans out ONLY to its own default instance, never the other profile's` — `dispatch-service.test.ts:204` (`expected [Array(3)] to deeply equal ['acme-slack']`). Encodes Success Criterion 1 (cross-profile isolation) directly.

The old non-discriminating fallback test (`:106`, defaults == enabled) still passes under the mutant, as expected — the two new tests are what close the gap. Reverted; `git diff` empty.

### Minor gap 2 — CLOSED
New test `DeliveryService.deliver › propagates a repository read failure (so the queue retries) without crashing other deliveries` (`delivery-service.test.ts:191`) uses a `ThrowingChannelRepository` whose `get()` throws `SQLITE_IOERR`, and asserts: (a) `deliver()` **rejects** with that error (propagate-for-retry contract — this is what lets BullMQ retry), (b) `http.calls` length 0 (throw at read time, before `buildInstance`/send — distinct from the send-failure path), (c) a healthy service delivers fine immediately after (per-job/process isolation, no shared-state corruption).

Verified genuine (not a tautology): in `delivery-service.ts` the read at `:38` sits OUTSIDE the try/catch that wraps only `channel.send()` (`:51-68`), so a throwing read propagates naturally. Confirmed by a scratch discriminating mutation — wrapped the read in `try { … } catch { return {ok:true, attempts:0} }` (swallow as no-op skip): the new test FAILED (`promise resolved … instead of rejecting`, `:211`), while the other 5 delivery tests stayed green. So the test kills the swallow-read regression, not just the happy path. Reverted; `git diff` empty. Edge-case 4 ("a failed DB read errors THAT send without crashing the process") is now directly asserted.

### Discrimination sensor — updated
| # | Mutation | Iter 1 | Iter 2 |
| - | -------- | ------ | ------ |
| b | dispatch fallback → all enabled ids | ❌ survived | ✅ **Killed** (2 tests: `dispatch-service.test.ts:173, :204`) |
| gap2 | delivery swallow throwing read as no-op | (untested) | ✅ **Killed** (`delivery-service.test.ts:211`) |

All 6 iteration-1 mutations (a,c,d,e,f) remain killed (unchanged production code). **6/6 P0 mutations now die; gap 2 guarded.**

### Gate (after all reverts)
- **Build**: `npm run build` — ✅ tsc + copy-admin-ui, no errors.
- **Full**: `npm run test` (`vitest run`, Docker up so the testcontainers integration test ran) — **251 passed / 0 failed / 0 skipped**, 37 files, ~10s. Matches the stated 248→251 (+3 tests from `06e703e`). No silent skips.
- **Tree**: `git status` clean — no tracked modifications; HEAD `06e703e`; only pre-existing untracked `.claude/ AGENTS.md CLAUDE.md`.

### Requirement traceability — updated
- **DBCH-06** → ✅ **Verified** (fallback discrimination gap closed; mutation b killed).
- Edge-case 4 (delivery-time read failure) → ✅ directly asserted.

### Iteration 2 verdict: PASS ✅
The surviving mutant is dead, gap 2 is closed, all gates green, tree clean, and the fix is strictly test-only (zero production risk delta). Feature `db-channels` passes verification.

**Unresolved questions**: none.
