# MCP Server Specification

## Problem Statement

Agents (Claude Code, Claude Desktop, any MCP client) should be able to send notifications through notify-hub as a first-class tool call instead of hand-rolling HTTP requests. Expose the gateway via a Model Context Protocol server.

## Goals

- [ ] An MCP client can call `send_notification` and the message is delivered through the existing gateway (202 + jobId).
- [ ] Agents can discover which channels are active before sending (`list_channels`).
- [ ] Registration in Claude Code is one documented command.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| MCP resources/prompts | Tools are the useful surface; YAGNI |
| HTTP/SSE MCP transport | Personal/local use → stdio; gateway HTTP API already exists for remote |
| Embedding queue/BullMQ in the MCP process | MCP server is a thin client of the running gateway (AD-012) |
| Auth beyond gateway token | MCP stdio is local; the gateway token remains the trust boundary |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Transport | stdio via official `@modelcontextprotocol/sdk` (TS) | Standard for local Claude Code/Desktop | n (agent default) |
| MCP server location | Same repo/package, `src/mcp/` + `src/bin/mcp.ts` | Reuses types, build, test stack | n (agent default) |
| Config | `NOTIFY_URL` + `NOTIFY_TOKEN` env; missing → fail fast at startup | Mirrors hook client + AD-007 fail-fast | n (agent default) |
| Channel discovery | New authenticated `GET /channels` on the gateway | Agents need valid `channels` values; API lacked it | n (agent default) |

**Open questions:** none — all logged above.

## User Stories

### P1: send_notification tool ⭐ MVP

**User Story**: As an agent, I want a `send_notification` tool so I can push messages to the user's devices mid-task.

**Acceptance Criteria**:
1. WHEN `send_notification` is called with `message` (+ optional `title`, `priority`, `tags`, `channels`) THEN the server SHALL POST to `${NOTIFY_URL}/notify` with `Authorization: Bearer ${NOTIFY_TOKEN}` and return the `jobId` from the 202 response.
2. WHEN the gateway returns non-2xx (400/401/503) THEN the tool SHALL return an error result (`isError: true`) containing the gateway's status and message — it SHALL NOT crash the server.
3. WHEN the gateway is unreachable THEN the tool SHALL return an error result, not an unhandled rejection.

**Independent Test**: Call the tool via an in-memory MCP client with a fake HTTP layer → assert exact request (URL, auth header, body) and returned jobId.

### P1: list_channels tool + GET /channels endpoint ⭐ MVP

**Acceptance Criteria**:
1. WHEN `GET /channels` is called with a valid token THEN the gateway SHALL return 200 `{ channels: string[], defaultChannels: string[] }` (active channels + the token profile's defaults).
2. WHEN the token is missing/unknown THEN `GET /channels` SHALL return 401.
3. WHEN `list_channels` is called THEN the MCP server SHALL return the parsed channel lists from that endpoint.

### P1: check_gateway_health tool ⭐ MVP

**Acceptance Criteria**:
1. WHEN `check_gateway_health` is called THEN the server SHALL GET `/health` and return status + redis indicator; unreachable gateway → error result.

### P1: stdio entrypoint + registration docs ⭐ MVP

**Acceptance Criteria**:
1. WHEN `node dist/bin/mcp.js` starts with `NOTIFY_URL`/`NOTIFY_TOKEN` set THEN it SHALL serve MCP over stdio.
2. WHEN either env var is missing THEN it SHALL exit non-zero with a message naming the missing variable.
3. Registration documented for Claude Code (`claude mcp add ...`) and generic MCP config JSON.

## Edge Cases

- WHEN gateway responds 400 (e.g. unknown channel) THEN tool result SHALL surface the validation message.
- WHEN NOTIFY_TOKEN is invalid THEN tool result SHALL surface 401 (not crash).
- Tool schemas SHALL constrain `priority` to `low|default|high|urgent`.

## Requirement Traceability

| Requirement ID | Story | Status |
| -------------- | ----- | ------ |
| MCP-01 | send_notification tool | Pending |
| MCP-02 | list_channels + GET /channels | Pending |
| MCP-03 | check_gateway_health tool | Pending |
| MCP-04 | stdio entrypoint + docs | Pending |
| MCP-05 | mockability: tools tested without network | Pending |

## Success Criteria

- [ ] `claude mcp add notify-hub ...` → Claude can push a notification to the phone via one tool call.
- [ ] All tools tested via in-memory MCP client + fake HTTP (no network), consistent with the project's Ports & Adapters testing model.
