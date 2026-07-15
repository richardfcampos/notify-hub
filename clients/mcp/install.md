# notify-hub MCP Server -- Install Guide

Exposes notify-hub as three MCP tools (`send_notification`, `list_channels`,
`check_gateway_health`) over stdio, so an agent (Claude Code, Claude
Desktop, any MCP client) can push notifications and check the gateway
without hand-rolling HTTP requests.

The MCP server is a **thin client of the running gateway** -- it does not
talk to Redis/BullMQ itself, so the gateway (`docker compose up`) must
already be up and reachable at `NOTIFY_URL`.

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
