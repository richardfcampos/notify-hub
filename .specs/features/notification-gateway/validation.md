# Notification Gateway Validation

**Date**: 2026-07-15
**Spec**: `.specs/features/notification-gateway/spec.md`
**Diff range**: `ebed742..HEAD` (33 commits; `src/**`, `clients/claude-code/**`, `Dockerfile`, `docker-compose.yml`)
**Verifier**: independent sub-agent (author ≠ verifier); read-only over real tree, mutations in throwaway state only

---

## Verdict

**Overall**: ❌ Not Ready (one P1 acceptance criterion has no verifying evidence)

- **Gate**: 106 passed, 0 failed (19 files); `npm run build` (tsc) clean.
- **Sensor**: 7 mutations injected, **7 killed, 0 survived** — the suite is genuinely discriminating.
- **Spec-anchored**: 12/16 requirements fully covered by real `file:line` assertions matching the spec-defined outcome. **NOTIF-02 (retry + dead-letter) is UNVERIFIED** by any automated test or by the performed smoke → FAIL trigger. Minor spec-precision / optional-feature gaps listed below.

The blocker is a **coverage** gap, not a defect: the tests that exist are strong and value-anchored. But a P1 MVP reliability guarantee rests entirely on a docker smoke that (by the plan's own definition) only hits `/health` + one send — it never exercises retry exhaustion or the dead-letter landing.

---

## Task Completion

All 24 tasks (T1–T24, incl. P2 T22 / P3 T24) are marked ✅ in `tasks.md`. No blocked/partial tasks. Test-count delta from greenfield: **+106**.

---

## Spec-Anchored Acceptance Criteria

### NOTIF-01 — Authenticated async notify API (P1)

| Criterion (WHEN → THEN) | Spec outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| Valid token + valid body → enqueue one job, 202 + jobId | 202, jobId string, 1 job | `src/api/server.e2e.test.ts:66` `expect(res.statusCode).toBe(202)`; `:68` `expect(typeof body.jobId).toBe('string')`; `:71` `expect(dispatched).toHaveLength(1)` + `:73-75` profile/message/channels | ✅ |
| Token missing → 401, enqueue nothing | 401, 0 jobs | `src/api/server.e2e.test.ts:103` `toBe(401)` + `:104` `expect(dispatched).toHaveLength(0)` | ✅ |
| Token unknown → 401, enqueue nothing | 401, 0 jobs | `src/api/server.e2e.test.ts:118` `toBe(401)` + `:119` `toHaveLength(0)` | ✅ |
| Invalid body (missing message) → 400, enqueue nothing | 400, 0 jobs | `src/api/server.e2e.test.ts:133` `toBe(400)` + `:134` `toHaveLength(0)` | ✅ |
| Invalid body (unknown channel) → 400 | 400 naming channel, 0 jobs | `src/api/server.e2e.test.ts:148` `toBe(400)` + `:149` `expect(res.json().error).toContain('bogus')` + `:150` 0 jobs | ✅ |
| Invalid body (wrong types) → 400 | 400 | `src/api/schemas/notify-schema.test.ts:69` non-string message; `:74` bad priority; `:82` bad tags (schema layer, not e2e) | ✅ |
| Redis unreachable at enqueue → 503, no hang | 503 | `src/api/server.e2e.test.ts:174` `toBe(503)` (throwing queue → catch → 503) | ⚠️ 503 asserted; the "does not hang"/timeout half of the AC is not directly asserted |

### NOTIF-02 — Durable queue: retry + dead-letter (P1)

| Criterion | Spec outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| Enqueued job processed by a worker (API does not send inline) | async worker | No direct assertion. Implied: route only enqueues a `DispatchJob` (`src/api/routes/notify.ts:52`) and e2e captures it via `onDispatch`; no `channel.send` in the route path. | ⚠️ Covered by architecture, not by a test asserting async/no-inline-send |
| Transient error → retry w/ exponential backoff up to max attempts | N retries, backoff | **No `file:line`.** `src/queue/bullmq-queue.ts:45-50` sets `attempts`/`backoff`, but `bullmq-queue.ts` has **no test** (matrix: "none — verified by docker smoke"), and the performed smoke was `/health` + one send only. | ❌ NOT covered |
| Retries exhausted → dead-letter (not dropped) + log | job parked in failed set | **No `file:line`.** `src/queue/bullmq-queue.ts:49` `removeOnFail: false`; never exercised by any test or by the smoke. | ❌ NOT covered |

### NOTIF-03 — Multi-channel fan-out (P1)

| Criterion | Spec outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| No `channels` → token default channels | defaults ∩ active | `src/dispatch/dispatch-service.test.ts:106` `expect(recorded.map(j=>j.channel)).toEqual(['ntfy','telegram'])`; `:31-35` resolveChannels default fallback | ✅ |
| `channels` given → exactly that set ∩ enabled+configured | requested ∩ active | `src/dispatch/dispatch-service.test.ts:21-28` `toEqual(['discord','ntfy'])`; `:37-41` filters non-active; `test/integration/fan-out.test.ts:101-103` requested subset only | ✅ |
| One channel fails → others still delivered + per-channel ok/error | 3 results, isolation | `test/integration/fan-out.test.ts:72` `toHaveLength(3)`; `:74-77` ntfy ok=false + error contains "ntfy is down", telegram/slack ok=true; `:67-69` all attempted | ✅ |
| Resolved set empty → logged no-op | 0 enqueue + warn | `src/dispatch/dispatch-service.test.ts:124` `expect(recorded).toEqual([])` + `:125-126` warn entry | ✅ |

### NOTIF-04 — Partial-failure isolation (P1)
Covered by `test/integration/fan-out.test.ts:41-78` (one FakeChannel throws, other two deliver; per-channel results recorded). ✅ — value-anchored (asserts `ok`/`error` state, not just that send was called).

### NOTIF-05..09 — Core channel adapters (P1)

| Req | `file:line` + assertion | Result |
| --- | --- | --- |
| NOTIF-05 ntfy | `src/channels/adapters/ntfy-channel.test.ts:35-46` exact URL `https://ntfy.sh/my-topic` + Title/Priority/Tags headers + body; `:58` omit-headers; `:61-72` non-2xx throws; `:74-85` timeout throws | ✅ |
| NOTIF-06 telegram | `src/channels/adapters/telegram-channel.test.ts:29` `expect(http.calls).toEqual([...])` (bot-token URL + chat_id/text body); `:39-50` non-2xx throws | ✅ |
| NOTIF-07 email | `src/channels/adapters/email-channel.test.ts:28` `expect(mail.calls).toEqual([{to,subject,text}])`; `:33-42` transport error throws | ✅ |
| NOTIF-08 slack | `src/channels/adapters/slack-channel.test.ts:29` webhook payload `{text:'*title*\nmsg'}`; `:39-50` non-2xx throws | ✅ |
| NOTIF-09 discord | `src/channels/adapters/discord-channel.test.ts:29-37` webhook payload `{content:'**title**\nmsg'}`; `:39-50` non-2xx throws | ✅ |
| NOTIF-05.6 truncate over-limit | `src/channels/decorators/truncating-channel.test.ts:39-43` delivered length == limit + ends with ellipsis; `:21-27` within-limit passthrough | ✅ |

### NOTIF-10 — Config + fail-fast (P1)

| Criterion | `file:line` + assertion | Result |
| --- | --- | --- |
| Only listed channels active | `src/config/load-config.test.ts:80-89` channelsEnabled/channelConfig limited to `ntfy`; `src/channels/channel-builder.ts:31-49` builds only enabled | ✅ |
| Listed channel missing cred → refuse start naming channel+key | `src/config/load-config.test.ts:14-19` `toThrowError(/slack/i)` + `toThrowError(/SLACK_WEBHOOK_URL/)`; unknown channel `:22-28` `toThrowError(/carrier-pigeon/)` | ✅ |
| Unlisted channel never attempted even if requested | `src/dispatch/dispatch-service.test.ts:37-41` filters `bogus`; `src/api/schemas/notify-schema.test.ts:49-59` unknown channel → invalid | ✅ |

### NOTIF-11 — Token → profile (P1)

| Criterion | `file:line` + assertion | Result |
| --- | --- | --- |
| Known token → profile; defaults used when channels omitted | `src/auth/token-resolver.test.ts:24-25` `resolve('tok-phone')` → exact profile; defaults exercised in `dispatch-service.test.ts:106` | ✅ |
| Unknown token → 401 | `src/auth/token-resolver.test.ts:30` unknown→null, `:35` undefined→null, `:40` empty→null; `src/api/server.e2e.test.ts:118` → 401 | ✅ |
| ≥1 configured token/profile | `src/config/load-config.test.ts:38-42` parses `Profile[]` | ✅ |

### NOTIF-12 — Docker Compose (P1)

| Criterion | Evidence | Result |
| --- | --- | --- |
| `docker compose up` → redis, api, worker start | `docker compose config --services` → `redis`, `api`, `worker`; `docker-compose.yml:21` api `depends_on` redis, `:24` healthcheck. No automated test; up-and-running is smoke-only (author-reported). | ⚠️ compose is structurally valid; runtime start is smoke-only |
| `GET /health` → 200 + ok + redis indicator | `src/api/server.e2e.test.ts:185-186` `toBe(200)` + `toEqual({status:'ok', redis:true})`; `:203-204` redis:false path | ✅ |
| `.env` read by all three services | compose only; no test | ⚠️ infra, smoke-only |

### NOTIF-13 — Claude Code hook client (P1)

| Criterion | `file:line` + assertion | Result |
| --- | --- | --- |
| Stop → event=end + project + summary(best-effort) + duration(best-effort) + timestamp | `clients/claude-code/notify-hook.test.mjs:67-69` event=end/project/timestamp; `:110`,`:124` summary fallback; `:137` durationMs omitted when uncached | ✅ |
| UserPromptSubmit → event=start (toggleable) | `notify-hook.test.mjs:82` event=start; `:193` toggle off → no fetch | ✅ |
| Notification → event=needs-input | `notify-hook.test.mjs:96-97` event + message | ✅ |
| Gateway down / non-2xx / timeout → exit 0 + log | `notify-hook.test.mjs:241` fetch-throws → resolves; `:260` non-2xx → resolves | ✅ (run() no-throw; literal `process.exit(0)` in `main()` untested — `main` not exported) |
| Transcript / start-time missing → send omitting field | `notify-hook.test.mjs:113-125` missing transcript → "Task finished"; `:127-138` no start-time → no durationMs key | ✅ |

### NOTIF-14 — Health endpoint (P1)
`src/api/server.e2e.test.ts:185-186`, `:203-204`. ✅

### NOTIF-15 — WhatsApp / CallMeBot (P2)
`src/channels/adapters/whatsapp-channel.test.ts:29-36` exact urlencoded GET; `:38-49` non-2xx throws; `:51-62` 429 rate-limit throws; `:64-75` transport error. ✅

### NOTIF-16 — Generic webhook (P3)
`src/channels/adapters/webhook-channel.test.ts:35-49` full-notification JSON POST (field values); `:51-67` optional-field omission; `:69-80` non-2xx throws. ✅

**Status**: ❌ Gaps present — NOTIF-02.2 / NOTIF-02.3 not covered; NOTIF-02.1, NOTIF-01.4, NOTIF-12.1/12.3 partial/spec-precision.

---

## Discrimination Sensor

Each mutation applied in isolation, targeted test run, then reverted via `git checkout --`. Tree confirmed clean after all.

| # | File | Mutation | Test run | Killed? |
| --- | --- | --- | --- | --- |
| 1 | `src/api/plugins/auth.ts:39` | `if (!profile)` → `if (profile)` (auth bypass) | `server.e2e.test.ts` | ✅ Killed — `expected 401 to be 202/400/503` (5 assertions) |
| 2 | `src/api/routes/notify.ts:53` | `reply.code(202)` → `code(200)` | `server.e2e.test.ts` | ✅ Killed — `expected 200 to be 202` |
| 3 | `src/config/load-config.ts:82` | disable missing-cred throw (`if(false && …)`) | `load-config.test.ts` | ✅ Killed — `expected [Function] to throw an error` |
| 4 | `src/queue/in-memory-queue.ts:50-59` | remove per-delivery try/catch (rethrow → aborts fan-out) | `fan-out.test.ts` | ✅ Killed — `expected [] to have length 1` |
| 5 | `src/channels/adapters/discord-channel.ts:26` | payload `content` → `text` | `discord-channel.test.ts` | ✅ Killed — deep-equal mismatch |
| 6 | `src/dispatch/dispatch-service.ts:26` | drop `active.has(channel)` from resolve filter | `dispatch-service.test.ts` | ✅ Killed — 5 `toEqual` failures |
| 7 | `clients/claude-code/notify-hook.mjs:197-214` | remove fetch try/catch (rethrow on error) | `notify-hook.test.mjs` | ✅ Killed — `promise rejected "network unreachable" instead of resolving` |

**Sensor depth**: P0-full (7 manual behavior-level mutations across auth, route, config, isolation, adapter, dispatch, hook).
**Result**: 7/7 killed — ✅ PASS. The automated tests reliably detect regressions in the code they cover.

> Note on M4: the isolation seam exercised by the integration test is `InMemoryQueue`'s per-delivery try/catch (a `src/` file used as a test double). In production, isolation is provided by BullMQ per-channel delivery jobs — which is part of the untested NOTIF-02 surface (see gaps).

---

## Payload / Conjunction Spot-Check

Payload-bearing assertions target field VALUES/STATE, not merely that a call happened:
- Adapters use `expect(http.calls).toEqual([{ method, url, headers, body }])` (full-object equality) — ntfy `:35`, discord `:29`, slack `:29`, telegram `:29`, whatsapp `:29`, webhook `:35`; email asserts `mail.calls` to/subject/text `:28`.
- Notify route asserts the captured `DispatchJob` fields (`server.e2e.test.ts:73-75`), not just a 202.
- Fan-out asserts per-channel `ok`/`error` state (`fan-out.test.ts:74-77`), not just "send called".
No shallow "was-called" conjunction masking a missing value assertion found.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code / no scope creep | ✅ adapters tiny; ports & DI as designed |
| Surgical changes / matches patterns | ✅ consistent Strategy+Adapter+Decorator across channels |
| Spec-anchored outcome check (asserted values match spec) | ✅ for covered ACs (values, not just presence) |
| Per-layer coverage expectation | ⚠️ domain/adapters 1:1; **BullMQ queue layer has zero automated coverage** (deliberate per matrix, but leaves NOTIF-02 unverified) |
| Every test maps to a spec req — no unclaimed tests | ✅ all 106 trace to an AC / edge case / Done-when |
| Documented guidelines followed | none — strong defaults applied (Vitest + injected fakes, zero network/Redis) |

---

## Edge Cases

- [x] `message` empty/whitespace → 400 — `notify-schema.test.ts:39-47`, e2e `:122-135`
- [x] `channels` unknown name → 400 — `notify-schema.test.ts:49-59`, e2e `:137-151`
- [x] All resolved channels disabled → logged no-op — `dispatch-service.test.ts:109-127`
- [x] Single adapter throws → others unaffected + per-channel status — `fan-out.test.ts:41-78`
- [x] Message over channel limit → truncate — `truncating-channel.test.ts:30-44`
- [x] Hook + gateway unreachable → never non-zero exit — `notify-hook.test.mjs:223-242`
- [ ] Two identical jobs (`dedupKey`) → collapse via BullMQ jobId — **NOT implemented.** `dedupKey` is extracted (`notify.ts:41-42`) and placed on `DispatchJob`, but `bullmq-queue.ts:59-63` calls `.add()` without passing it as `jobId`, so no collapse occurs. Spec marks this optional/best-effort, so non-blocking — but it is captured-then-dropped, and untested.

---

## Gate Check

- **Command**: `npm run build` (tsc) + `npm run test` (vitest run)
- **Build**: clean (no tsc errors)
- **Tests**: 106 passed, 0 failed, 0 skipped (19 files)
- **Test count before feature**: 0 (greenfield) → **after: 106** (delta +106)
- **Skipped/failures**: none

---

## Fix Plans

### Fix 1 (Blocker — coverage): NOTIF-02 retry/backoff + dead-letter unverified
- **Root cause**: `bullmq-queue.ts` has no automated test (planned "smoke-only"), and the performed smoke was `/health` + one successful send — it never forces a transient failure, so neither retry-count (NOTIF-02.2) nor dead-letter landing (NOTIF-02.3) has any verifying evidence.
- **Fix task**: Add an integration test against an ephemeral Redis (Testcontainers or a CI redis service) that points a channel at an always-failing transport and asserts: (a) the delivery job is attempted `attempts` times, (b) after exhaustion it remains in the failed set (`removeOnFail:false`) rather than being dropped. Alternatively, extend the docker smoke to force one exhausted job and assert its presence in the failed set.
- **Priority**: Blocker (P1 reliability AC with zero verification).

### Fix 2 (Minor): `dedupKey` captured but never applied
- **Root cause**: `notify.ts` threads `dedupKey` onto `DispatchJob`; `bullmq-queue.ts` ignores it when calling `.add()`.
- **Fix task**: Pass `jobId: dedupKey` in `enqueueDispatch` job opts when present (best-effort collapse), or remove the plumbing if intentionally deferred. Add a unit/integration assertion.
- **Priority**: Minor (spec marks it optional/best-effort).

### Fix 3 (Minor / spec-precision): NOTIF-01.4 "no hang"
- **Root cause**: 503 path asserted, but the "does not hang" (timeout) half is not exercised.
- **Fix task**: Optional — assert the 503 resolves within a bounded time when the queue rejects; or accept as spec-precision (the code path is synchronous try/catch, so hang is not structurally possible).
- **Priority**: Minor.

---

## Requirement Traceability Update

| Requirement | Previous | New |
| --- | --- | --- |
| NOTIF-01 | Implementing | ✅ Verified (⚠️ 01.4 "no-hang" spec-precision) |
| NOTIF-02 | Implementing | ❌ Needs Fix (retry + dead-letter unverified) |
| NOTIF-03 | Implementing | ✅ Verified |
| NOTIF-04 | Implementing | ✅ Verified |
| NOTIF-05..09 | Implementing | ✅ Verified |
| NOTIF-10 | Implementing | ✅ Verified |
| NOTIF-11 | Implementing | ✅ Verified |
| NOTIF-12 | Implementing | ⚠️ Partial (health ✅; stack-up/.env smoke-only) |
| NOTIF-13 | Implementing | ✅ Verified (literal `process.exit(0)` in `main()` untested) |
| NOTIF-14 | Implementing | ✅ Verified |
| NOTIF-15 (P2) | Implementing | ✅ Verified |
| NOTIF-16 (P3) | Implementing | ✅ Verified |

---

## Summary

**Overall**: ❌ Not Ready (single P1 coverage blocker)

**Spec-anchored**: 12/16 requirements fully value-anchored; NOTIF-02 unverified; NOTIF-01.4 / NOTIF-12 / dedupKey are partial or optional.
**Sensor**: 7/7 mutations killed — tests are discriminating.
**Gate**: 106 passed, 0 failed; build clean.

**What works**: auth (401), validation (400 empty/whitespace/unknown-channel/wrong-type), enqueue (202+jobId), 503-on-queue-down, fan-out resolution + partial-failure isolation with per-channel ok/error, all seven adapter payloads (value-asserted), truncation, config fail-fast naming channel+key, token→profile, health endpoint, hook event-map/payload/exit-0/best-effort omission. Every one survived the sensor.

**Issues found**:
1. NOTIF-02 retry/backoff + dead-letter — no automated test and not exercised by the smoke (Blocker; add Redis-backed integration test or extend smoke).
2. `dedupKey` captured then dropped — never used as BullMQ jobId (Minor; optional feature).
3. NOTIF-01.4 "no hang" and NOTIF-13.4 literal `process.exit(0)` — spec-precision, not directly asserted (Minor).

**Next steps**: Route Fix 1 to an implementer (add the retry/dead-letter integration test against ephemeral Redis) and re-verify. Fixes 2–3 are non-blocking; confirm with the user whether `dedupKey` should be wired or removed.
