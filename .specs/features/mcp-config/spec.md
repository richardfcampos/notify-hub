# MCP Config Surface Specification

## Problem Statement

notify-hub's MCP surface is send-only (stdio: send_notification/list_channels/check_gateway_health). The user manages all their MCPs through their mcp-manager gateway (`intel:7788`, registers servers by `url`) and wants to CONFIGURE notify-hub from there too: full channel/profile management as MCP tools, reachable by the gateway over HTTP.

## Goals

- [ ] An MCP client (via mcp-manager's `call_mcp_tool`) can list, create, edit, enable/disable and delete channel instances and profiles — changes live immediately (hot-reload, same as the panel).
- [ ] notify-hub exposes MCP over Streamable HTTP at `/mcp` on the admin service (port 8081) so mcp-manager registers it by URL — no stdio spawning inside the gateway container.
- [ ] The send toolset remains available on the same endpoint (one registration covers configure + send).

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Auth on the MCP endpoint | Same trust boundary as the panel (AD-015: LAN/tailnet open); the mcp-manager gateway adds its own consumer-token layer |
| Removing the stdio bin | Kept for direct Claude Code registration (`clients/mcp/install.md`) |
| mcp-manager-side changes | Registration is data entry in its UI/API, not code |
| SSE / legacy transports | Streamable HTTP only (modern SDK default) |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Placement | MCP endpoint hosted by the ADMIN server at `POST /mcp` (8081) | Config tools = config surface; admin already has repos + validation + gateway-client; 0.0.0.0 bind reachable from the gateway container | n (agent default) |
| Transport mode | Streamable HTTP, stateless (no session persistence) if the installed SDK supports it cleanly, else minimal session handling | Single trusted client (the gateway); simplest correct thing | n (worker verifies vs SDK) |
| Validation path | Config-mutating tools reuse the exact same `config-validation` + repo apply path as `PUT /api/config` | One source of truth; write-time fail-fast preserved | n (agent default) |
| Secrets over MCP | `get_config` returns full configs incl. secrets (like GET /api/config) | Same trust model as the panel | n (agent default) |
| Tool granularity | Entity-level tools (upsert_channel, delete_channel, upsert_profile, delete_profile) rather than one whole-config PUT | Ergonomic for AI callers; each validated against the würde-be full state | n (agent default) |

**Open questions:** none — all logged above.

## User Stories

### P1: Config tools over MCP ⭐ MVP
**Acceptance Criteria**:
1. WHEN `get_config` is called THEN it SHALL return every channel instance (id, label, type, enabled, config) and profile (id, name, token, defaultChannels) from the DB.
2. WHEN `upsert_channel` is called with a valid instance THEN it SHALL persist (create or update) and be live on the next send; WHEN invalid (bad slug id, unknown type, enabled-missing-required-key) THEN it SHALL return an isError result naming the problem and persist NOTHING.
3. WHEN `delete_channel` is called THEN the instance SHALL be removed (and pruned from profile defaults); unknown id → isError naming it.
4. WHEN `upsert_profile` / `delete_profile` are called THEN same semantics (validation: default refs must exist + be enabled; duplicate token rejected).
5. WHEN `test_channel {channelId}` is called THEN it SHALL send a real test through the gateway targeting that instance and return the actual worker outcome.
6. WHEN `get_status` is called THEN it SHALL return gateway health + channel list + recent deliveries (same data as the panel's status).

### P1: Streamable HTTP endpoint ⭐ MVP
**Acceptance Criteria**:
1. WHEN a standard MCP client connects to `POST /mcp` on the admin service THEN initialize/tools-list/tools-call SHALL work over Streamable HTTP (verified in tests with the official SDK client).
2. WHEN the send tools (send_notification, list_channels, check_gateway_health) are called on this endpoint THEN they SHALL behave exactly as the stdio server's (shared tool registration — no duplicated logic).
3. WHEN the admin service starts via docker compose THEN `/mcp` SHALL be available with no extra configuration.

### P2: Registration docs
1. `clients/mcp/install.md` SHALL document registering the HTTP endpoint in mcp-manager (url `http://host.docker.internal:8081/mcp` from a container on the same host / `http://<host>:8081/mcp` otherwise) alongside the existing stdio instructions.

## Edge Cases
- WHEN a config tool races a panel edit THEN last-write-wins per entity (single-user tool; same as today).
- WHEN the MCP client sends malformed tool args THEN the SDK schema validation SHALL reject with a proper MCP error (no crash, no partial write).
- WHEN the gateway API is down THEN send/test tools return isError results; config tools still work (they hit the DB directly).

## Requirement Traceability
| ID | Story | Status |
| -- | ----- | ------ |
| MCPC-01 | get_config tool | Implemented |
| MCPC-02 | upsert/delete channel tools + validation | Implemented |
| MCPC-03 | upsert/delete profile tools + validation | Implemented |
| MCPC-04 | test_channel + get_status tools | Implemented |
| MCPC-05 | Streamable HTTP endpoint on admin (/mcp) | Implemented |
| MCPC-06 | Shared send toolset on the endpoint | Implemented |
| MCPC-07 | Registration docs (mcp-manager) | Implemented |

## Success Criteria
- [ ] From a session connected to the mcp-manager gateway: `list_mcps` shows notify-hub → `get_mcp_tools` lists the config+send tools → `call_mcp_tool` creates a channel instance → it appears in the panel and delivers, no restart.
- [ ] All tool behavior tested via the official SDK client against the HTTP endpoint with fake/temp repos — no Docker in the suite.
