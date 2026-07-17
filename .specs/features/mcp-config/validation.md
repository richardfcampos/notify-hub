# MCP Config Surface Validation

**Date**: 2026-07-17
**Spec**: `.specs/features/mcp-config/spec.md`
**Diff range**: `0d7116a..HEAD` (8f812b6 shared registry + config tools, 39ba409 HTTP endpoint, 3ec9ad8 docs+smoke, 555e852 docs)
**Verifier**: independent sub-agent (author ≠ verifier). READ-ONLY; sensor mutations run in scratch and reverted immediately.

**Verdict**: ✅ PASS

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| C1: Shared registry + config tools | ✅ Done | registerSendTools + registerConfigTools; config-service/status-service/test-send-service extracted |
| C2: Streamable HTTP endpoint on admin | ✅ Done | `POST /mcp` stateless, SDK StreamableHTTPServerTransport, per-request server |
| C3: Docs + live smoke | ✅ Done | install.md + README; live smoke re-run here |

---

## Spec-Anchored Acceptance Criteria

### P1: Config tools over MCP (MCPC-01..04)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| MCPC-01 get_config returns every channel (id,label,type,enabled,config) + profile (id,name,token,defaultChannels) incl. secrets | full config payload from DB | `register-config-tools.test.ts:71` — `JSON.parse(firstText).toEqual({channels:[...], profiles:[...token:'tok-acme'...]})` | ✅ PASS |
| MCPC-02 upsert_channel valid → persists, live next send | channel written to repo | `register-config-tools.test.ts:90` — `channelRepo.list().toEqual([channel])`; update-in-place `:103` | ✅ PASS |
| MCPC-02 invalid bad-slug → isError naming it, persist NOTHING | isError + repo unchanged | `register-config-tools.test.ts:115-117` — `isError=true`, text contains `"Not A Slug"`, `list().toEqual([])` | ✅ PASS |
| MCPC-02 invalid unknown-type → isError naming it, persist NOTHING | exact message | `:130-131` — `toBe('Channel "acme-x" has unknown type "carrier-pigeon"')`, `list().toEqual([])` | ✅ PASS |
| MCPC-02 enabled missing required key → isError naming instance+key, persist NOTHING | exact message | `:144-145` — `toBe('Channel "acme-slack" is enabled but missing required config "SLACK_WEBHOOK_URL"')`, `list().toEqual([])` | ✅ PASS |
| MCPC-03 delete_channel removes + prunes profile defaults | instance gone, profile default pruned | `:160-161` — `channelRepo.list().toEqual([])`, `profileRepo.get('acme').defaultChannels.toEqual([])` | ✅ PASS |
| MCPC-03 delete_channel unknown id → isError naming it, nothing changes | error + unchanged | `:171-172` — `toBe('unknown channel "ghost"')`, `list().toEqual([{keep}])` | ✅ PASS |
| MCPC-03/04 upsert_profile ref must exist | isError naming ref, persist NOTHING | `:201-202` — `toBe('Profile "acme" has default channel "ghost" which does not exist')`, `list().toEqual([])` | ✅ PASS |
| MCPC-03/04 upsert_profile ref must be enabled | isError naming ref, persist NOTHING | `:216-217` — `toBe('...default channel "acme-ntfy" which is not enabled')`, `list().toEqual([])` | ✅ PASS |
| MCPC-03/04 upsert_profile duplicate token rejected | isError, persist NOTHING | `:230-231` — `toBe('Duplicate token for profile "new-guy"')`, repo unchanged | ✅ PASS |
| MCPC-04 delete_profile happy + unknown | deletes / isError naming id | `:242-243`, `:253-254` — `toBe('unknown profile "ghost"')` | ✅ PASS |
| MCPC-04 test_channel sends real test via gateway, returns actual worker outcome | worker delivery outcome | `:287` — `firstText.toBe('sent')`; unknown `:297`, disabled `:307`, gateway-down isError `:318` | ✅ PASS |
| MCPC-04 get_status returns gateway health + channels + recent deliveries | full status shape | `:337-342` — `toEqual({gateway:{up:false},channels:[],defaultChannels:[],recentDeliveries:[]})` | ✅ PASS |
| Config tool set = exactly 7 | 7 named tools | `:51-59` — sorted names `toEqual([...7...])` | ✅ PASS |

### P1: Streamable HTTP endpoint (MCPC-05, MCPC-06)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| MCPC-05 SDK client → POST /mcp initialize/tools-list over real HTTP | all 10 tools (3 send + 7 config) | `mcp-route.e2e.test.ts:67-78` — real `StreamableHTTPClientTransport` on ephemeral port, sorted names `toEqual([...10...])` | ✅ PASS |
| MCPC-05 tools-call over HTTP (config) | round-trips against seeded repos | `mcp-route.e2e.test.ts:91` get_config; `:102-103` upsert_channel write-through `channelRepo.get('acme-ntfy')` | ✅ PASS |
| MCPC-05 GET/DELETE without session | 405 | `mcp-route.e2e.test.ts:134`, `:146` — `res.status.toBe(405)` | ✅ PASS |
| MCPC-05 admin starts via compose, /mcp available no extra config | endpoint reachable | wiring `admin-server.ts:35 registerMcpRoute(app, deps)`; **live** GET /mcp→405, SDK client 10 tools on `127.0.0.1:8081` | ✅ PASS (live) |
| MCPC-06 send tools behave exactly as stdio (shared registration, no duplicated logic) | identical send behavior | `mcp-route.e2e.test.ts:117-120` — send_notification → `POST localhost:8080/notify`, `Bearer tok-phone`, body `{message:'hi'}`; stdio parity `mcp-server.test.ts:63-67` exactly 3 send tools | ✅ PASS |

### P2: Docs (MCPC-07)

| Criterion | `file:line` | Result |
| --------- | ----------- | ------ |
| install.md documents HTTP endpoint in mcp-manager (host.docker.internal / host url) + trust model | `clients/mcp/install.md:88-128` — `http://host.docker.internal:8081/mcp`, `http://intel:8081/mcp`, unauthenticated + consumer-token note; README:174-177 | ✅ PASS (build gate) |

**Status**: ✅ All ACs covered with spec-exact assertions.

---

## Route / Tool Sharing (no duplicated logic — imports cited)

| Behavior | Route import | MCP tool import | Same fn? |
| -------- | ------------ | --------------- | -------- |
| config read/validate | `config-routes.ts:15` `getFullConfig` + `:44` `validateConfigPayload` | `register-config-tools.ts:20-28` upsert/delete entity + `getFullConfig` from `../admin/config-service.js` (which calls `validateConfigPayload` at `config-service.ts:62,95`) | ✅ same validation path |
| status | `status-route.ts:9` `getStatusSummary` from `../status-service.js` | `register-config-tools.ts:29` `getStatusSummary` from `../admin/status-service.js` | ✅ identical fn |
| test-send | `test-send-route.ts:11` `runTestSend` from `../test-send-service.js` | `register-config-tools.ts:30` `runTestSend` from `../admin/test-send-service.js` | ✅ identical fn |
| send tools | stdio `mcp-server.ts:11` `registerSendTools` | HTTP `build-admin-mcp-server.ts:20` `registerSendTools` (same `./register-send-tools.js`) | ✅ identical fn |

Confirmed: routes and MCP tools call the SAME service functions; entity-level tools reuse the SAME `validateConfigPayload` rules as `PUT /api/config`. No drift.

---

## Discrimination Sensor

Scratch mutations, one at a time, reverted via `git checkout` after each. Lightweight tier (5 targeted behavior-level faults on highest-risk new code — data-integrity + endpoint parity).

| # | File:line | Injected fault | Test run | Killed? |
| - | --------- | -------------- | -------- | ------- |
| a | `config-service.ts:66` | upsert_channel persists BEFORE validation (`repo.upsert` moved above validation gate) | register-config-tools.test.ts | ✅ Killed — 3 nothing-persisted assertions failed (bad-slug/unknown-type/missing-key `list().toEqual([])`) |
| b | `config-service.ts:77-84` | delete_channel skips pruning profile defaults (prune loop removed) | register-config-tools.test.ts | ✅ Killed — "prunes it from every profile default" failed |
| c | `build-admin-mcp-server.ts:51` | HTTP endpoint registers only send tools (config registration dropped) | mcp-route.e2e.test.ts | ✅ Killed — 3 e2e failed (10-tools list, get_config round-trip, upsert write-through) |
| d | `config-validation.ts:95` | upsert_profile allows ref to a disabled instance (enabled check disabled) | register-config-tools.test.ts | ✅ Killed — "rejects a default channel ref that is disabled" failed |
| e | `mcp-server.ts:21` | stdio server also registers a config tool (parity break) | mcp-server.test.ts | ✅ Killed — "registers exactly the three notify-hub tools" failed (stdio tool COUNT is asserted — no gap) |

**Sensor depth**: lightweight (5 mutations)
**Result**: 5/5 killed — ✅ PASS. Tree clean after all reverts (only pre-existing untracked `.claude/ AGENTS.md CLAUDE.md`).

---

## Live Sanity (read-only)

Real SDK `Client` + `StreamableHTTPClientTransport` → `http://127.0.0.1:8081/mcp` (running `notify-hub-admin-1` container):

- `initialize` + `tools/list` → **TOOL_COUNT=10**: check_gateway_health, delete_channel, delete_profile, get_config, get_status, list_channels, send_notification, test_channel, upsert_channel, upsert_profile.
- `get_status` (read-only) → isError=false, `gateway={"up":true,"redis":true}`, 5 channels, 0 recent deliveries.
- No mutating tool invoked; `get_config` NOT called (secrets not printed). Temp check script deleted; tree re-verified clean.

---

## Edge Cases

- [x] Gateway down → send/test tools isError, config tools still work: `register-config-tools.test.ts:310-319` (test_channel `gateway unreachable: ECONNREFUSED`), `:322-343` (get_status returns full shape with `gateway.up:false` while config path unaffected). ✅
- [x] Last-write-wins per entity on race with panel edit: inherent to single-user repo upsert semantics (spec: "same as today"); no dedicated test. ⚠️ Documented behavior, not separately asserted (acceptable).
- [ ] Malformed tool args → SDK schema validation rejects with proper MCP error, no crash/no partial write: **no explicit test.** SDK enforces the zod `inputSchema` passed at `registerTool` before the handler runs (so no partial write is structurally guaranteed), but there is no `file:line` asserting the rejection/`-32602`/nothing-persisted. ⚠️ Informational gap.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep | ✅ Entity-level tools + one endpoint; shared services extracted, not duplicated |
| Surgical changes / matches patterns | ✅ Routes reduced to thin mappers over shared services; DI seams reused (fakes) |
| Spec-anchored outcome check (asserted values match spec) | ✅ Exact error strings + repo-state assertions |
| Per-layer coverage (domain 1:1 ACs; routes happy+edge+error) | ✅ config tools unit + HTTP e2e + stdio parity |
| Every test maps to a spec requirement — no unclaimed tests | ✅ 36 new tests trace to MCPC-01..06 + edge cases |
| Handler-never-throws discipline | ✅ `tool-result.ts` + try/catch in send tools + route 500 fallback |
| No secrets leaked in logs | ✅ get_config not exercised live; trust model = panel parity (spec) |

---

## Gate Check

- **Build**: `npm run build` — ✅ clean (tsc + copy-admin-ui).
- **Full**: `npm run test` — **277 passed, 0 failed, 0 skipped** (39 files). Docker available (testcontainers test ran).
- **Test count**: baseline 251 → 277 (+26 new; e2e + config-tools + parity). No tests deleted, no assertions weakened.

---

## Requirement Traceability Update

| Requirement | Previous | New |
| ----------- | -------- | --- |
| MCPC-01 get_config | Implemented | ✅ Verified |
| MCPC-02 upsert/delete channel + validation | Implemented | ✅ Verified |
| MCPC-03 upsert/delete profile + validation | Implemented | ✅ Verified |
| MCPC-04 test_channel + get_status | Implemented | ✅ Verified |
| MCPC-05 Streamable HTTP endpoint | Implemented | ✅ Verified (tests + live) |
| MCPC-06 shared send toolset | Implemented | ✅ Verified |
| MCPC-07 registration docs | Implemented | ✅ Verified (build gate) |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 7/7 ACs matched spec outcome; 1 informational edge-case gap (malformed-args), 1 inherent edge case (race) not separately tested.
**Sensor**: 5/5 mutations killed.
**Gate**: 277 passed, build ok.
**Live**: 10 tools over real HTTP; gateway up=true, redis=true.
**Tree clean**: yes.

**What works**: All 10 tools served over real Streamable HTTP via the official SDK client; every config-mutation validation failure persists nothing (proven by repo-state assertions + mutation a); delete_channel prunes profile defaults (mutation b); upsert_profile rejects missing/disabled refs + duplicate tokens (mutation d); endpoint serves both toolsets (mutation c); stdio stays at exactly 3 send tools (mutation e); routes and tools share one implementation per behavior (imports cited).

**Ranked gaps** (informational, non-blocking):
1. Malformed-args edge case (spec Edge Case) has no explicit test asserting SDK schema rejection → proper MCP error + nothing persisted. SDK-guaranteed but unasserted. — add a test calling e.g. `upsert_channel` with a missing required field and asserting `isError`/thrown MCP error + `repo.list()` unchanged.
2. Race last-write-wins edge case not separately tested — inherent to single-user upsert semantics; optional to cover.

**Next steps**: Optionally add the malformed-args edge-case test (gap #1) to close the spec's Edge Case list at evidence level. Feature is production-ready as-is.
