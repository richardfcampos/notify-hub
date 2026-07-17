# MCP Config Surface — Tasks

**Spec**: `.specs/features/mcp-config/spec.md`
**Status**: Implementation complete (C1-C3), pending Verifier
**Design (inline)**: One shared tool-registration module used by BOTH transports: the existing stdio bin (send tools) and a new Streamable HTTP endpoint mounted on the admin Fastify server at `POST /mcp` (config + send tools). Config tools call the same `config-validation` + repositories the admin PUT route uses (hot-reload for free). Worker verifies the installed `@modelcontextprotocol/sdk@1.29.x` Streamable HTTP server API before writing code — never fabricate.

## Test Coverage Matrix (inherits project conventions)

| Layer | Test Type | Coverage Expectation | Location | Command |
| ----- | --------- | -------------------- | -------- | ------- |
| MCP config tools | unit/e2e via SDK client ↔ HTTP endpoint (fake repos) | per tool: happy + each validation isError + nothing-persisted-on-failure | `src/mcp/*.test.ts` | `npm run test:unit` |
| Streamable HTTP endpoint | e2e (SDK client against a listening admin server on an ephemeral port) | initialize + tools/list (full set) + a send tool + a config tool round-trip | `src/mcp/*.test.ts` or `src/admin/**` | `npm run test` |
| Shared registration (stdio parity) | unit | stdio server still exposes the 3 send tools unchanged | existing `src/mcp/mcp-server.test.ts` stays green | `npm run test:unit` |
| Docs | none | build gate | — | `npm run build` |

Gates: quick=`npm run test:unit`, full=`npm run test`, build=`npm run build`.

## Execution Plan — Phase 1 (Sequential)
```
C1 → C2 → C3
```

### C1: Shared tool registry + config tools ✅
**What**: refactor `src/mcp/mcp-server.ts` into a shared registration module (`registerSendTools(server, deps)` + new `registerConfigTools(server, {channelRepo, profileRepo, gatewayClient/deps, validation})`); implement MCPC-01..04 tools (get_config, upsert_channel, delete_channel, upsert_profile, delete_profile, test_channel, get_status) reusing `config-validation.ts` semantics (validate against would-be full state; isError naming problem; nothing persisted on failure). Zod input schemas per tool. stdio bin unchanged in behavior.
**Requirement**: MCPC-01..04, MCPC-06 · **Tests**: unit (fake repos, InMemory/HTTP as fits) · **Gate**: quick
**Commit**: `feat(mcp): shared tool registry with config management tools` (8f812b6)

### C2: Streamable HTTP endpoint on admin ✅
**What**: mount `POST /mcp` (+ GET/DELETE if the SDK transport requires them) on the admin Fastify server via the SDK's Streamable HTTP server transport (stateless mode if supported by the installed SDK — verify). Wire repos + gateway client from admin deps. e2e: official SDK client connects over real HTTP (ephemeral port), lists all tools (send + config), calls one of each.
**Requirement**: MCPC-05, MCPC-06 · **Tests**: e2e · **Gate**: full
**Commit**: `feat(admin): mcp streamable http endpoint` (39ba409)

### C3: Docs + live smoke ✅
**What**: `clients/mcp/install.md` + README: section "Registering in an MCP gateway (e.g. mcp-manager)" — url `http://host.docker.internal:8081/mcp` (gateway container on same host) / `http://<host>:8081/mcp`; note trust model (endpoint unauthenticated like the panel; gateway adds consumer tokens). Live smoke against the running stack: rebuild admin, connect a real SDK client to `http://127.0.0.1:8081/mcp`, tools/list, `get_config` (assert instances present; do NOT print secret values), `get_status`. 
**Requirement**: MCPC-07 · **Tests**: none · **Gate**: build + full-suite sanity
**Commit**: `feat(mcp): gateway registration docs and live smoke` (3ec9ad8)

## Implementation Summary

- Gate: `npm run build && npm run test` -- 277 passed, 0 failed (baseline 251, +26 new).
- SDK: `@modelcontextprotocol/sdk@1.29.0`, `StreamableHTTPServerTransport` from `server/streamableHttp.js`, stateless mode (`sessionIdGenerator: undefined`), per-request `McpServer` + transport, `handleRequest(request.raw, reply.raw, request.body)` via Fastify `reply.hijack()`. GET/DELETE /mcp -> 405 (matches the SDK's own `simpleStatelessStreamableHttp.ts` example).
- Shared services extracted: `src/admin/config-service.ts` (entity upsert/delete + validation against would-be full state), `src/admin/test-send-service.ts`, `src/admin/status-service.ts` -- each used by both the admin HTTP route and the corresponding MCP tool.
- Live smoke (rebuilt `admin` container): 10 tools listed, `get_status` gateway.up=true, `get_config` returned 5 channel ids + 1 profile id (no secret values logged).

## Validation
Verifier runs after C3 (author ≠ verifier): spec-anchored MCPC-01..07 + sensor (validation-bypass persists?, delete prunes defaults?, endpoint actually serves both toolsets, stdio parity); writes `.specs/features/mcp-config/validation.md`.
