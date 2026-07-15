# notify-hub

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
  -> dispatch worker resolves channel set
  -> one delivery job per channel                [Redis / BullMQ]
  -> delivery worker sends via the channel's adapter
     (ntfy / telegram / email / slack / discord / whatsapp / webhook)
```

- **API** only validates + enqueues; it never sends inline, so a slow/broken
  channel can't make `/notify` hang.
- **Worker** does the actual fan-out and delivery; each channel gets its own
  job so retries/failures are isolated per channel (one channel down doesn't
  block the others).
- **Channels are pluggable**: each one implements the same tiny interface
  (`send(notification)`); enabling one is a config toggle + credentials, and
  adding a brand-new one is a small adapter file (see the generic `webhook`
  adapter as the reference example).

## Quickstart

```bash
git clone <this-repo> notify-hub && cd notify-hub
cp .env.example .env
# edit .env: set TOKENS, CHANNELS_ENABLED, and creds for the channels you want
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
| `channels` | no | subset of your enabled channels to target this send to; omit to use the token's default channels |
| `metadata` | no | free-form object, passed through to channel adapters (e.g. the `webhook` channel) |

Responses: `202 {jobId}` (enqueued) · `400` (invalid body / unknown channel
name) · `401` (missing/unknown token) · `503` (queue unreachable, so the
caller never hangs).

## Configuration

All config is env vars (see [`.env.example`](./.env.example) for every key).
Key ones:

- `PORT` -- API listen port (compose maps `${PORT:-8080}` on the host).
- `TOKENS` -- `;`-separated `name:token:defaultChannel1,defaultChannel2`
  entries. Example: `phone:supersecrettoken:ntfy,telegram;desktop:othertoken:discord`.
- `CHANNELS_ENABLED` -- comma-separated list of channels to activate, e.g.
  `ntfy,telegram,discord`. **A channel not listed here is never attempted**,
  even if a request asks for it. **A listed channel missing its required
  credentials makes the service refuse to start**, naming the channel and
  the missing key -- so misconfiguration is caught immediately, not as a
  silent drop later.

## Channels

Each row is the env keys a channel needs once it's in `CHANNELS_ENABLED`.

| Channel | Env keys | Setup notes |
| ------- | -------- | ----------- |
| `ntfy` | `NTFY_URL`, `NTFY_TOPIC` | Use `https://ntfy.sh` (public) or your own self-hosted ntfy server; subscribe to the topic in the ntfy app |
| `telegram` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Create a bot via [@BotFather](https://t.me/BotFather); get your chat id by messaging the bot then hitting `getUpdates` |
| `email` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_TO` | Any SMTP provider (Gmail app password, SendGrid, etc.) |
| `slack` | `SLACK_WEBHOOK_URL` | Slack app -> Incoming Webhooks -> add to a channel |
| `discord` | `DISCORD_WEBHOOK_URL` | Server channel settings -> Integrations -> Webhooks |
| `whatsapp` | `WHATSAPP_PHONE`, `WHATSAPP_APIKEY` | Free personal API via [CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/) -- message their bot to activate, rate-limited |
| `webhook` | `WEBHOOK_URL` | Reference extensibility adapter: POSTs the full notification JSON to any URL you control (Gotify, a custom listener, etc.) |

Adding a brand-new channel: implement the `NotificationChannel` interface
(one `send()` method) in `src/channels/adapters/`, export a
`ChannelRegistryEntry` (factory + required env keys), and add one line to
`src/channels/channel-registry.ts`. No other core changes needed.

## Claude Code hook

A zero-dependency hook script pushes "start" / "end" / "needs-input" events
to notify-hub globally, across every Claude Code project. See
[`clients/claude-code/install.md`](./clients/claude-code/install.md) for the
full setup (settings.json snippet + env vars).

## Development

```bash
npm install
npm run build        # tsc -> dist/bin/{api,worker}.js
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
