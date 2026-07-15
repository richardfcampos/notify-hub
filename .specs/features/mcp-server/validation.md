# MCP Server Validation

**Date**: 2026-07-15
**Spec**: `.specs/features/mcp-server/spec.md`
**Diff range**: `e43e685..HEAD` (36f07f0 /channels, 209657e MCP server+tools, 97d781a entrypoint+docs, 2d89e9e docs)
**Verifier**: independent sub-agent (author ≠ verifier), read-only over real tree; mutations in scratch state, reverted

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| M1 GET /channels endpoint | ✅ Done | route + 3 e2e tests; wired in `container.ts:94` |
| M2 MCP server + tools | ✅ Done | 3 tools, injectable fetch (MCP-05), 12 unit tests |
| M3 Entrypoint + docs | ✅ Done | `bin/mcp.ts`, `start:mcp` script, README + install.md; env fail-fast untested (see gaps) |

---

## Spec-Anchored Acceptance Criteria

### MCP-01: send_notification tool

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| Called with args → POST `${NOTIFY_URL}/notify` w/ `Authorization: Bearer` + return jobId | url `/notify`, POST, `Bearer tok-test`, exact body, jobId from 202 | `mcp-server.test.ts:92` url `toBe .../notify`; `:94-96` `headers.authorization toBe 'Bearer tok-test'` + content-type; `:97-103` body `toEqual` all 5 fields; `:89` text `toContain 'job-123'` | ✅ PASS |
| Gateway non-2xx (400/401/503) → `isError:true` w/ status+message, no crash | isError true, text has status + gateway msg | `mcp-server.test.ts:106-123` `it.each([400,401,503])`: `:119` `isError toBe true`; `:120` `toContain String(status)`; `:121` `toContain 'boom'` | ✅ PASS |
| Gateway unreachable → error result, not unhandled rejection | isError true, text has network failure | `mcp-server.test.ts:125-136` `TypeError('fetch failed')` → `:134` `isError toBe true`; `:135` `toContain 'fetch failed'` | ✅ PASS |

### MCP-02: list_channels + GET /channels

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| GET /channels valid token → 200 `{channels[], defaultChannels[]}` | 200, both arrays; active ≠ defaults | `server.e2e.test.ts:225` status `toBe 200`; `:226-229` `toEqual {channels:['ntfy','telegram','email'], defaultChannels:['ntfy']}` (arrays deliberately differ → no accidental swap-pass) | ✅ PASS |
| Missing/unknown token → 401 | 401 | `server.e2e.test.ts:238` missing header `toBe 401`; `:251` unknown token `toBe 401` | ✅ PASS |
| list_channels → return parsed channel lists | active + default lists surfaced | `mcp-server.test.ts:151` `toContain 'ntfy, telegram'`; `:152` `toContain 'Default channels for this token: ntfy'`; `:155` url `/channels`; `:158` auth header. +401 surface `:161-172`, unreachable `:174-182` | ✅ PASS |

### MCP-03: check_gateway_health tool

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| Called → GET /health, return status + redis indicator; unreachable → error | GET /health, "status: ok, redis: true" | `mcp-server.test.ts:195` `toContain 'Gateway status: ok, redis: true'`; `:197` url `/health`; 503 `:201-212` isError; unreachable `:214-222` isError | ✅ PASS |

### MCP-04: stdio entrypoint + registration docs

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| `node dist/bin/mcp.js` w/ env set → serve MCP over stdio | connects StdioServerTransport | `bin/mcp.ts:24-26` builds server + StdioServerTransport + connect; build gate compiles. No runtime/integration test (matrix scopes to build gate) | ⚠️ Build-only (no assertion) |
| Either env var missing → exit non-zero naming the missing variable | process.exit(1) + stderr names var | `bin/mcp.ts:15-22` checks `!notifyUrl`/`!token`, `console.error('...NOTIFY_URL' / '...NOTIFY_TOKEN')`, `process.exit(1)` — **no test** | ❌ GAP (no `file:line` test) — Minor |
| Registration documented (claude mcp add + generic JSON) | both documented | `clients/mcp/install.md:36-40` (`claude mcp add`), `:51-64` (generic `mcpServers` JSON); `README.md:117-126` | ✅ PASS (doc) |

### MCP-05: mockability (tools tested without network)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| All tools tested via in-memory MCP client + fake HTTP, no network | injectable `fetchImpl`, InMemoryTransport | `mcp-server.ts:18,43` `fetchImpl?` seam; `mcp-server.test.ts:23-49` `fakeFetch` + `InMemoryTransport.createLinkedPair()`; no real fetch anywhere | ✅ PASS |

**Status**: 4/5 requirements fully spec-anchored (MCP-01/02/03/05). MCP-04 partial: docs ✅, stdio serve build-only, env fail-fast untested (Minor).

---

## Edge Cases

- [x] Gateway 400 (unknown channel) → surface validation message: MCP layer `mcp-server.test.ts:120-121` surfaces status+body; gateway layer `server.e2e.test.ts:149` `error toContain 'bogus'`. Covered across both layers.
- [x] Invalid NOTIFY_TOKEN → surface 401 not crash: `mcp-server.test.ts:161-172` (list_channels 401) + send_notification 401 in `it.each`. Covered.
- [⚠️] Tool schemas constrain `priority` to `low|default|high|urgent`: constraint present in code `mcp-server.ts:56` `z.enum(['low','default','high','urgent'])` (SDK-enforced at boundary), but **no test asserts an invalid priority is rejected**. Spec-precision gap — Minor.

---

## Gate Check

- **Build**: `npm run build` (tsc) → 0 errors. SDK API (`registerTool`, `CallToolResult`, `McpServer`, `StdioServerTransport`, `InMemoryTransport`, `Client`) resolves + type-checks → not fabricated.
- **Full**: `npm run test` (Docker-backed) → **21 files, 124 passed, 0 failed, 0 skipped**.
- **Test count**: before feature 109 → after 124 → **+15** (12 MCP unit + 3 /channels e2e). No test deleted, no assertion weakened.
- **After all mutations**: `git status` clean, `npm run test` 124 passed.

---

## Discrimination Sensor

Sensor depth: lightweight (5 behavior-level mutations, scratch state, each reverted via `git checkout --`).

| # | File:line | Mutation | Expected killer | Killed? |
| - | --------- | -------- | --------------- | ------- |
| a | `mcp-server.ts:66` | Drop `authorization` header from send_notification fetch | auth assertion | ✅ Killed — `mcp-server.test.ts:95` `expected undefined to be 'Bearer tok-test'` |
| b | `mcp-server.ts:75` | Non-2xx returns `textResult` (not `errorResult`) | error-surface tests | ✅ Killed — 3 fail: `send_notification surfaces 400/401/503 as isError` |
| c | `channels.ts:15` | Remove `preHandler: authPreHandler` from /channels | e2e auth test | ✅ Killed — `GET /channels returns 200...` fails (profile undefined → 401). NB: the two 401 tests survive this specific mutation due to the defensive in-route `if(!profile)` 401 guard (defense-in-depth); removal still detected by the happy-path test |
| d | `mcp-server.ts:67` | POST body drops `priority`/`channels` fields | exact-body assertion | ✅ Killed — `posts to /notify with the auth header and exact body` fails (`toEqual`) |
| e | `mcp-server.ts:96` | list_channels fetches `/health` not `/channels` | URL assertion | ✅ Killed — `list_channels GETs /channels...` fails |

**Result**: 5/5 killed — PASS ✅. Assertions target field VALUES (body `toEqual`, url `toBe`, header `toBe`, text `toContain`), not call counts — non-shallow.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code, no scope creep | ✅ thin client; 3 tools only; no queue/Redis coupling (AD-012) |
| Surgical changes, only required files | ✅ diff limited to route/server/mcp/bin + docs |
| Matches existing patterns | ✅ reuses `createAuthPreHandler`; injectable-deps style mirrors `server.ts` |
| Handlers never throw (spec MCP-01.2/3) | ✅ try/catch around fetch + `!response.ok` branch + JSON-parse guard `mcp-server.ts:33-40` |
| Spec-anchored outcome check (asserted values match spec) | ✅ (MCP-04.2 excepted — untested) |
| Per-layer coverage: MCP tools happy+error+unreachable; /channels happy+401 | ✅ |
| Every test maps to a spec AC / edge case — no unclaimed tests | ✅ |
| Documented guidelines followed | tasks.md coverage matrix (inherits notification-gateway conventions) |

Positive: `/channels` e2e deliberately sets `activeChannelNames ≠ defaultChannels` so a field-swap can't pass by accident; `channels.ts` has belt-and-suspenders 401 guard behind the preHandler.

---

## Requirement Traceability Update

| Requirement | Previous | New |
| ----------- | -------- | --- |
| MCP-01 | Pending | ✅ Verified |
| MCP-02 | Pending | ✅ Verified |
| MCP-03 | Pending | ✅ Verified |
| MCP-04 | Pending | ⚠️ Verified w/ gaps (env fail-fast untested; stdio serve build-only; docs ✅) |
| MCP-05 | Pending | ✅ Verified |

---

## Ranked Gaps (all Minor, non-blocking)

1. **MCP-04.2 env fail-fast untested** — `bin/mcp.ts:15-22` (missing NOTIFY_URL/NOTIFY_TOKEN → `process.exit(1)` naming the var) has no test. tasks.md matrix claims "fail-fast env check covered in mcp unit tests" but `buildMcpServer` takes url/token as params and never reads `process.env`; the env read lives only in the untested entrypoint. Consistent with the prior notification-gateway entrypoint `process.exit` precedent (shipped validated). Build gate confirms compile. Severity: Minor.
2. **priority enum has no negative test** — `mcp-server.ts:56` `z.enum([...])` present + SDK-enforced, but no test asserts an invalid `priority` is rejected. Edge case "schemas SHALL constrain priority" is code-present, not test-anchored. Severity: Minor.

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 4/5 requirements fully covered (MCP-01/02/03/05 + MCP-02 endpoint); MCP-04 partial (docs ✅, stdio build-only, env fail-fast untested)
**Sensor**: 5/5 mutations killed
**Gate**: 124 passed, 0 failed; build ok; tree clean after mutations

**What works**: All three tools assert exact URL/auth/body/result-text with a fake fetch over a real in-memory SDK client (MCP-05); gateway non-2xx and unreachable both surface as `isError:true` without crashing; `/channels` returns correct distinct arrays and 401s missing/unknown tokens at two layers.

**Issues found**: 2 Minor coverage gaps (env fail-fast entrypoint untested; priority enum no negative test) — both non-blocking, matching accepted precedent. Recommend a follow-up test for `bin/mcp.ts` env fail-fast and one invalid-priority rejection assertion.

**Verdict**: PASS ✅
