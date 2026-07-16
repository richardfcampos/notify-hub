# notify-hub

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Docker Compose](https://img.shields.io/badge/Docker-compose%20up-2496ED?logo=docker&logoColor=white)](./docker-compose.yml)
[![MCP](https://img.shields.io/badge/MCP-server-8A2BE2)](./clients/mcp/install.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

Self-hosted, free, multi-channel notification gateway. `POST` one message
with a token and it fans out -- asynchronously, via a durable queue -- to
every channel you've enabled: ntfy, Telegram, Email, Slack, Discord,
WhatsApp, or a generic webhook. Built so a [Claude Code](#claude-code-hook)
hook can push you "task started" / "task finished" / "Claude needs you"
notifications across every project, without ever blocking Claude.

## Why

Claude Code (or any long-running script) leaves you watching a terminal for
minutes with no way to know when it's done or needs input. notify-hub is a
tiny, 100% free, self-hosted service you run once (`docker compose up`) that
turns "send me a push" into a one-line HTTP call, decoupled from delivery by
a Redis-backed queue with retries and per-channel dead-lettering.

## Architecture

```
client (curl / hook script)
  -> POST /notify (Bearer token)                [Fastify API]
  -> enqueue dispatch job                        [Redis / BullMQ]
  -> dispatch worker resolves the profile's default (or requested)
     channel instance ids against SQLite                  [config store]
  -> one delivery job per resolved instance      [Redis / BullMQ]
  -> delivery worker loads that instance's type + config from SQLite
     at send time and builds/sends via the type's adapter
     (ntfy / telegram / email / slack / discord / whatsapp / webhook)
```

- **API** only validates + enqueues; it never sends inline, so a slow/broken
  channel can't make `/notify` hang.
- **Worker** does the actual fan-out and delivery; each channel *instance*
  gets its own job so retries/failures are isolated per instance (one
  company's Slack going down doesn't block another's).
- **Config lives in SQLite, read fresh at request/delivery time** -- there is
  no in-memory snapshot to restart. Add a channel, flip enabled, edit a
  webhook URL, or repoint a profile's defaults in the admin panel and the
  very next `/notify` call already uses it (hot-reload, no
  `docker compose restart`).
- **Channels are typed, instances are named**: the six adapter *types*
  (ntfy/telegram/email/slack/discord/webhook) are the pluggable interface
  (`send(notification)`); on top of a type you can create any number of
  named *instances* -- `acme-slack`, `globex-slack`, `pessoal-discord` --
  each with its own id, label and credentials. Profiles pick which instance
  ids they route to by default; `POST /notify`'s `channels` field targets
  instance ids directly. Adding a brand-new *type* is still a small adapter
  file (see the generic `webhook` adapter as the reference example); adding
  a new *instance* of an existing type is just a panel click, no code.

## Quickstart

```bash
git clone https://github.com/richardfcampos/notify-hub.git && cd notify-hub
./scripts/setup-env.sh   # guided setup: prompts for each channel's credentials
                         # (hidden input), generates your gateway token, writes
                         # .env with chmod 600. Or do it by hand:
                         #   cp .env.example .env && $EDITOR .env
docker compose up -d --build
curl http://localhost:8080/health
# => {"status":"ok","redis":true}
```

Send a notification:

```bash
curl -X POST http://localhost:8080/notify \
  -H "Authorization: Bearer <your-token-from-TOKENS>" \
  -H "Content-Type: application/json" \
  -d '{"title":"notify-hub","message":"hello from notify-hub"}'
# => 202 {"jobId":"..."}
```

`POST /notify` accepts:

| Field | Required | Notes |
| ----- | -------- | ----- |
| `message` | yes | non-empty string |
| `title` | no | defaults to `"Notification"` |
| `priority` | no | one of `low`, `default`, `high`, `urgent` |
| `tags` | no | string array, passed through to channels that support it (e.g. ntfy) |
| `channels` | no | subset of channel **instance ids** (from `GET /channels`) to target this send to; omit to use the token's profile default instances |
| `metadata` | no | free-form object, passed through to channel adapters (e.g. the `webhook` channel) |

Responses: `202 {jobId}` (enqueued) · `400` (invalid body / unknown channel
instance id) · `401` (missing/unknown token) · `503` (queue unreachable, so
the caller never hangs).

`GET /channels` (same Bearer auth) lists every configured instance and the
calling token's profile defaults:

```json
{
  "channels": [
    { "id": "acme-slack", "label": "Acme Slack", "type": "slack", "enabled": true },
    { "id": "ntfy", "label": "Ntfy", "type": "ntfy", "enabled": true }
  ],
  "defaultChannels": ["ntfy"]
}
```

## Configuration

**Channels and token profiles live in SQLite and are managed live in the
[admin panel](#admin-panel)** (`http://127.0.0.1:8081`) -- add, edit, enable/
disable, or delete a channel instance, or change a profile's default
instances, and it takes effect on the very next `/notify` call. There is no
"apply" or restart step.

`.env` (see [`.env.example`](./.env.example)) only carries two kinds of
vars now:

- **Infra**: `PORT` (API listen port), `REDIS_URL`, `DB_PATH` (SQLite file
  location; compose points this at a named volume so it survives container
  recreates), `RETRY_ATTEMPTS`/`RETRY_BACKOFF_MS`, `ADMIN_PORT`/`ADMIN_BIND`.
- **First-boot seed**: `TOKENS` and `CHANNELS_ENABLED` plus each channel's
  credential vars (`NTFY_URL`, `SLACK_WEBHOOK_URL`, etc.) are read **once**,
  only when the service starts against an **empty** database -- each
  enabled channel becomes a named instance (id = its type, e.g. `slack`),
  and `TOKENS` entries become profiles. Once the database has any channel
  in it, these vars are ignored entirely; from then on, manage everything
  in the panel. Missing credentials for an otherwise-enabled seed channel
  seed it as a *disabled* instance rather than blocking boot -- fix its
  config in the panel and flip it on.

## Channels

Each row is the config keys a channel **instance** of that type needs (set
per-instance in the admin panel; the same keys the seed reads from `.env`
on first boot).

| Type | Config keys | Setup notes |
| ---- | ----------- | ----------- |
| `ntfy` | `NTFY_URL`, `NTFY_TOPIC` | Use `https://ntfy.sh` (public) or your own self-hosted ntfy server; subscribe to the topic in the ntfy app |
| `telegram` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Create a bot via [@BotFather](https://t.me/BotFather); get your chat id by messaging the bot then hitting `getUpdates` |
| `email` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_TO` | Any SMTP provider (Gmail app password, SendGrid, etc.) |
| `slack` | `SLACK_WEBHOOK_URL` | Slack app -> Incoming Webhooks -> add to a channel |
| `discord` | `DISCORD_WEBHOOK_URL` | Server channel settings -> Integrations -> Webhooks |
| `whatsapp` | `WHATSAPP_PHONE`, `WHATSAPP_APIKEY` | Free personal API via [CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/) -- message their bot to activate, rate-limited |
| `webhook` | `WEBHOOK_URL` | Reference extensibility adapter: POSTs the full notification JSON to any URL you control (Gotify, a custom listener, etc.) |

You can create **any number of named instances per type** -- e.g. an
`acme-slack` and a `globex-slack`, each with its own webhook URL -- from the
"Add channel" flow in the admin panel: pick the type, give it an id (slug)
and a label, fill in that type's config keys, save. Each profile then picks
which instance ids it defaults to.

Adding a brand-new channel **type**: implement the `NotificationChannel`
interface (one `send()` method) in `src/channels/adapters/`, export a
`ChannelRegistryEntry` (factory + required config keys), and add one line to
`src/channels/channel-registry.ts`. No other core changes needed -- the
admin panel picks up new types automatically via `GET /api/channel-types`.

## Claude Code hook

A zero-dependency hook script pushes "start" / "end" / "needs-input" events
to notify-hub globally, across every Claude Code project. See
[`clients/claude-code/install.md`](./clients/claude-code/install.md) for the
full setup (settings.json snippet + env vars).

## MCP server

notify-hub also ships as an MCP (Model Context Protocol) server over stdio,
exposing three tools -- `send_notification`, `list_channels`,
`check_gateway_health` -- so an agent (Claude Code, Claude Desktop, any MCP
client) can push notifications and check the gateway as tool calls instead
of hand-rolled HTTP. It's a thin client of the already-running gateway (no
direct Redis access). See
[`clients/mcp/install.md`](./clients/mcp/install.md) for the full setup
(`claude mcp add` command + generic `mcpServers` JSON config).

## Admin panel

A local, dark-themed dashboard for managing everything above directly in
SQLite -- no `.env` hand-editing, no restart:

- **Named channel instances**: add any number of instances of a type (e.g.
  `acme-slack` + `globex-slack`, both type `slack`, each its own webhook) --
  pick a type from the live `GET /api/channel-types` list, give it an id
  (slug) + label, fill in that type's credentials (masked by default,
  revealed with one click), toggle enabled, or delete it.
- Manage token profiles: add/remove, edit the token, and pick each
  profile's default channel **instances** by label (chips).
- **Save** validates (dup id, unknown type, an enabled instance missing a
  required key, a profile referencing a disabled/missing instance) and
  writes straight to the DB as an upsert+delete diff against the current
  state -- **live for the very next `/notify` call, no `docker compose`
  apply/restart step.**
- **Send test** per instance posts a real notification and shows the actual
  delivery outcome (✅ sent, or the real failure reason ❌), not just
  "enqueued".
- Live gateway status (health, redis, configured instances) and a tail of
  recent worker deliveries.

Comes up automatically as part of the stack -- no extra step:

```bash
docker compose up -d
# => http://127.0.0.1:8081
```

`npm run admin` still works as a host-side dev alternative (no Docker
rebuild needed while iterating on the panel itself):

```bash
npm run admin
# => admin panel: http://127.0.0.1:8081
```

**Reachability:** in compose the host-side bind defaults to `0.0.0.0`
(like the other services on a typical homelab host), so the panel is
reachable from your other devices -- e.g. over a Tailscale tailnet as
`http://<machine>:8081`. **The panel has no auth and displays secrets**,
so anyone who can reach the port can read and rewrite your config: keep
that surface to networks you trust (a WireGuard/Tailscale tailnet is a
good fit; an untrusted LAN is not). Set `ADMIN_BIND=127.0.0.1` in `.env`
to make it localhost-only. The explicit bind template is asserted by
`src/admin/compose-invariants.test.ts`. The host-side dev mode
(`npm run admin`) binds `127.0.0.1` by default regardless.

**Docker-socket trade-off:** config CRUD never touches Docker -- a Save
writes straight to the shared SQLite volume and is live immediately. The
`admin` service still mounts `/var/run/docker.sock` (plus a read-only copy
of `docker-compose.yml`) for one narrower purpose: the status page and
"Send test" outcome both tail `docker compose logs worker` to show real
delivery results instead of just "enqueued". This gives the admin
container control of the host's Docker daemon, the same pattern used by
tools like Portainer, scoped in code to log reads only (no compose
up/down/restart is ever invoked). Accepted because the panel is a personal
tool on a trusted network -- combined with the reachability note above,
treat "who can open the panel" as "who can administer this Docker host".

## Development

```bash
npm install
npm run build        # tsc -> dist/bin/{api,worker,admin}.js, copies
                      #   src/admin/ui -> dist/admin/ui (static UI assets)
npm run test          # full suite -- REQUIRES Docker (spins up redis:7-alpine
                      #   via testcontainers for the BullMQ retry/dead-letter
                      #   integration test); set REDIS_TEST_URL to reuse a
                      #   running Redis instead of a container
npm run test:unit     # no-Docker fast subset (src unit tests only)
npm run test:integration  # just the Redis-backed queue integration test
npm run dev:api        # tsx, no build step
npm run dev:worker
```

## Verified

`docker compose up -d --build` was run end-to-end against a real ntfy.sh
topic:

- `docker compose ps` -- all 3 services (`redis`, `api`, `worker`) up, `api`
  healthcheck `healthy`.
- `curl http://localhost:8080/health` -> `200 {"status":"ok","redis":true}`.
- `curl -X POST http://localhost:8080/notify -H "Authorization: Bearer <token>" -d '{"title":"notify-hub","message":"smoke test"}'`
  -> `202 {"jobId":"1"}`.
- Worker log: `{"channel":"ntfy","msg":"sending notification"}` followed by
  `{"channel":"ntfy","msg":"notification sent"}`.
- Confirmed on the ntfy side too: `curl "https://ntfy.sh/<topic>/json?poll=1"`
  returned the exact message: `{"title":"notify-hub","message":"smoke test", ...}`.

If your environment can't reach the public internet (ntfy.sh), point
`NTFY_URL` at a self-hosted ntfy instance instead and repeat the same smoke
steps.

## Contributing

Contributions are welcome — the most useful one is a new channel adapter.
Each channel is a small self-contained file implementing one interface:

1. Add `src/channels/adapters/<name>-channel.ts` implementing
   `NotificationChannel` (a single `send(notification)` method) plus its
   `ChannelRegistryEntry` (factory + required env keys).
2. Register it with one line in `src/channels/channel-registry.ts`.
3. Add unit tests next to it (happy path + error path, using the fakes in
   `test/helpers/fakes.ts` — no real network in tests).
4. `npm run test:unit` must pass; open a PR.

Ideas: Gotify, Matrix, Pushover, Signal, Mattermost, Rocket.Chat, SMS
gateways. Bug reports and docs fixes are equally appreciated —
[open an issue](https://github.com/richardfcampos/notify-hub/issues).

## License

[MIT](./LICENSE) © Richard Campos
