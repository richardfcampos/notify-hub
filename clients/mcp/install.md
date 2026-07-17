# notify-hub MCP Server -- Install Guide

notify-hub exposes MCP over two transports:

- **stdio** (this guide, sections 1-4 below): three send tools
  (`send_notification`, `list_channels`, `check_gateway_health`), spawned
  per-client by your MCP host (Claude Code, Claude Desktop, ...). A thin
  client of the running gateway -- it does not talk to Redis/BullMQ itself.
- **Streamable HTTP at `/mcp` on the admin service** (see
  ["Registering in an MCP gateway"](#registering-in-an-mcp-gateway-eg-mcp-manager)
  below): the same three send tools PLUS seven config management tools
  (`get_config`, `upsert_channel`, `delete_channel`, `upsert_profile`,
  `delete_profile`, `test_channel`, `get_status`), for MCP gateways
  (mcp-manager and similar) that register servers by URL instead of
  spawning a process.

The stdio server does not need Redis/BullMQ itself, but the gateway
(`docker compose up`) must already be up and reachable at `NOTIFY_URL`.

## 1. Start the gateway first

```bash
cd /path/to/notify-hub
cp .env.example .env   # edit with your channel creds + a token
docker compose up -d
curl http://localhost:8080/health   # {"status":"ok","redis":true}
```

## 2. Build the MCP server

```bash
cd /path/to/notify-hub
npm install
npm run build
realpath dist/bin/mcp.js
# e.g. /Users/you/code/notify-hub/dist/bin/mcp.js
```

You'll paste this absolute path into the registration commands below.

## 3. Register with Claude Code

```bash
claude mcp add notify-hub \
  --env NOTIFY_URL=http://localhost:8080 \
  --env NOTIFY_TOKEN=<your-token-from-TOKENS> \
  -- node /abs/path/to/notify-hub/dist/bin/mcp.js
```

Replace `/abs/path/to/notify-hub/dist/bin/mcp.js` with the real absolute
path from step 2, and `<your-token-from-TOKENS>` with a token configured in
the gateway's `TOKENS` env var.

## 4. Register with Claude Desktop (or any generic MCP client)

Add this to your MCP config (Claude Desktop:
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "notify-hub": {
      "command": "node",
      "args": ["/abs/path/to/notify-hub/dist/bin/mcp.js"],
      "env": {
        "NOTIFY_URL": "http://localhost:8080",
        "NOTIFY_TOKEN": "<your-token-from-TOKENS>"
      }
    }
  }
}
```

Restart the client after editing its config so it reconnects to the server.

## Tools

| Tool | Input | What it does |
| ---- | ----- | ------------- |
| `send_notification` | `message` (required), `title`, `priority` (`low`\|`default`\|`high`\|`urgent`), `tags`, `channels` (all optional) | `POST`s to `${NOTIFY_URL}/notify`; returns the queued `jobId` |
| `list_channels` | none | `GET`s `${NOTIFY_URL}/channels`; returns the active channels and the token's default channels |
| `check_gateway_health` | none | `GET`s `${NOTIFY_URL}/health`; returns gateway status + Redis reachability |

Every tool returns an error result (never a crash/exception) when the
gateway responds non-2xx or is unreachable -- the error text names the
HTTP status and body, or the network failure.

## Registering in an MCP gateway (e.g. mcp-manager)

MCP gateways that register servers **by URL** rather than spawning a stdio
process (e.g. mcp-manager) should point at the admin service's Streamable
HTTP endpoint instead of the stdio bin above -- no process to spawn inside
the gateway's own container, and the admin service is already running
(`docker compose up -d admin` or the full stack).

**URL:**

- From a container on the same Docker host as notify-hub's `admin` service:
  `http://host.docker.internal:8081/mcp`
- From another host on the same LAN/tailnet (e.g. a machine named `intel`):
  `http://intel:8081/mcp`

No API key, header, or other credential is needed by the endpoint itself --
see the trust model note below.

**Tools exposed on this endpoint** (10 total -- the three stdio send tools
above, PLUS seven config management tools):

| Tool | Input | What it does |
| ---- | ----- | ------------- |
| `get_config` | none | Returns every channel instance and profile, including secrets |
| `upsert_channel` | `id`, `label`, `type`, `enabled`, `config` (record) | Creates/updates a channel instance; validated the same way as the panel's save (slug id, known type, required config when enabled) -- rejects and writes nothing on a bad value |
| `delete_channel` | `id` | Deletes a channel instance and prunes it from every profile's default channels; unknown id -> error |
| `upsert_profile` | `id`, `name`, `token`, `defaultChannels` (array) | Creates/updates a token profile; default channel refs must exist and be enabled, tokens must be unique -- rejects and writes nothing on a bad value |
| `delete_profile` | `id` | Deletes a token profile; unknown id -> error |
| `test_channel` | `channelId` | Sends a real test notification through the gateway targeting one instance and reports the actual worker delivery outcome |
| `get_status` | none | Gateway health + channel list + recent worker deliveries -- the same data as the panel's status view |

A change made through any of these tools is live immediately (hot-reload,
same as saving in the panel) -- no restart, no `docker compose apply`.

**Trust model:** this endpoint is **unauthenticated by design**, same trust
boundary as the admin panel itself (AD-015: LAN/tailnet open, not
internet-exposed). It also returns secrets in full (`get_config` includes
channel credentials and profile tokens) -- treat it exactly like direct
access to the admin panel. Access control is the gateway's job: put
notify-hub's admin service on a private network/tailnet only, and rely on
the MCP gateway's own consumer-token layer (e.g. mcp-manager's per-consumer
tokens) to decide who can reach it through the gateway.

## Troubleshooting

- **Server won't start / exits immediately**: `NOTIFY_URL` or `NOTIFY_TOKEN`
  is missing. The process logs `mcp: missing required environment variable
  <NAME>` to stderr and exits non-zero -- check your MCP client's env
  config (step 3/4) for a typo.
- **Tools return `isError: true` naming a status/body**: the gateway
  rejected the request. `401` means the token doesn't match anything in
  `TOKENS`; `400` means the request body failed validation (e.g. an unknown
  channel name) -- the error text names the problem.
- **Tools return `isError: true` naming a network failure**: the gateway
  isn't reachable at `NOTIFY_URL`. Confirm it's up: `curl
  $NOTIFY_URL/health` should return `{"status":"ok","redis":true}`.
- **Client doesn't see the tools at all**: confirm you ran `npm run build`
  after the last pull (the client runs `dist/bin/mcp.js`, not the
  TypeScript source), and that the absolute path in your registration
  points at that built file.
- **Never debug via stdout**: the MCP server only ever writes JSON-RPC
  frames to stdout and diagnostics to stderr. If you need to see what's
  happening, run `node dist/bin/mcp.js` directly in a terminal (with
  `NOTIFY_URL`/`NOTIFY_TOKEN` exported) and watch stderr.
