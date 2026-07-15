# MCP Server Tasks

**Spec**: `.specs/features/mcp-server/spec.md`
**Status**: In Progress
**Scope**: Medium — 1 phase, 3 tasks, design inline (thin stdio client over the gateway HTTP API, per AD-012).

## Test Coverage Matrix (inherits notification-gateway conventions)

| Code Layer | Test Type | Coverage Expectation | Location | Run Command |
| ---------- | --------- | -------------------- | -------- | ----------- |
| API route `GET /channels` | e2e (inject) | 200 happy + 401 | `src/api/**/*.e2e.test.ts` | `npm run test` |
| MCP tools | unit (in-memory MCP client + fake fetch) | Per tool: happy + gateway error + unreachable; exact request asserted | `src/mcp/*.test.ts` | `npm run test:unit` |
| stdio entrypoint / docs | none | Build gate + fail-fast env check covered in mcp unit tests | — | `npm run build` |

Gate commands unchanged: quick=`npm run test:unit`, full=`npm run test`, build=`npm run build`.

## Execution Plan — Phase 1 (Sequential)

```
M1 → M2 → M3
```

### M1: GET /channels endpoint
**What**: Authenticated route returning `{ channels: activeChannelNames, defaultChannels: profile.defaultChannels }` + e2e tests (200 with correct arrays; 401 missing/unknown token).
**Where**: `src/api/routes/channels.ts`, register in `src/api/server.ts` (+ e2e test)
**Requirement**: MCP-02 · **Tests**: e2e · **Gate**: full
**Commit**: `feat(api): authenticated channel discovery endpoint`

### M2: MCP server + tools
**What**: `src/mcp/mcp-server.ts` — `buildMcpServer({ notifyUrl, token, fetchImpl })` (injectable fetch = mockable, MCP-05) registering tools `send_notification` (zod schema: message required, title/priority/tags/channels optional; priority enum), `list_channels`, `check_gateway_health`. Gateway non-2xx/unreachable → tool result `isError: true` with status+message (never throws out of the handler). Unit tests via SDK `InMemoryTransport` client pair + fake fetch: exact URL/auth/body asserted; jobId returned; 400/401/503 surfaced; network reject surfaced. Add dep `@modelcontextprotocol/sdk` (verify current API via docs-seeker/context7 — do not fabricate).
**Requirement**: MCP-01, MCP-02, MCP-03, MCP-05 · **Tests**: unit · **Gate**: quick
**Commit**: `feat(mcp): stdio server exposing notify tools`

### M3: Entrypoint + registration docs
**What**: `src/bin/mcp.ts` (fail-fast on missing NOTIFY_URL/NOTIFY_TOKEN naming the var, stdio transport), `package.json` script `start:mcp`, README section + `clients/mcp/install.md` (claude mcp add + generic JSON config).
**Requirement**: MCP-04 · **Tests**: none (env fail-fast asserted in M2 tests if factored there, else note) · **Gate**: build
**Commit**: `feat(mcp): stdio entrypoint and registration docs`

## Validation

Verifier runs automatically after M3 (author ≠ verifier): spec-anchored coverage for MCP-01..05 + discrimination sensor on the new surface; writes `.specs/features/mcp-server/validation.md`.
