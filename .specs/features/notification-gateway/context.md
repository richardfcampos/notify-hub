# Notification Gateway Context

**Gathered:** 2026-07-15
**Spec:** `.specs/features/notification-gateway/spec.md`
**Status:** Ready for design

---

## Feature Boundary

A self-hosted, free notification gateway (Docker + Redis queue) exposing a token-authenticated `POST /notify` API that fans one message out to multiple independently-enabled channels (ntfy, Telegram, Email, Slack, Discord in MVP; WhatsApp/CallMeBot in P2). Ships with a global Claude Code hook client that pushes on task start, task end, and when Claude needs the user. Not a hosted SaaS, not a UI, not a message archive.

---

## Implementation Decisions

### Stack & runtime
- Node.js/TypeScript. Fastify for the API, BullMQ (Redis-backed) for queue + worker.
- Three processes: `api`, `worker`, `redis` — orchestrated by `docker-compose.yml`.

### Transport / auth
- Client sends `POST /notify` with `Authorization: Bearer <token>`.
- Tokens defined in config; each token maps to a profile `{ name, defaultChannels[] }`.
- Single-user personal use is the target; multiple tokens allowed but no user CRUD.

### Channels (pluggable adapter interface)
- MVP: ntfy, Telegram, Email (SMTP), Slack (webhook), Discord (webhook).
- P2: WhatsApp via CallMeBot.
- P3: generic `webhook` adapter as the reference plugin (Gotify etc. follow the same interface).
- A channel is "active" only if listed in `CHANNELS_ENABLED` AND its required config is present; enabled-but-misconfigured = fail fast at startup.
- Per-request `channels` overrides the profile default, intersected with active channels.

### Delivery semantics
- Async only — API enqueues, worker delivers.
- Retry with exponential backoff up to a configured max; exhausted → dead-letter (not dropped).
- Partial-failure isolation: one channel failing never stops the others; per-channel result recorded.

### Claude Code hook (client)
- Global install in `~/.claude/settings.json`.
- Event mapping: `UserPromptSubmit` → `start`, `Stop` → `end`, `Notification` → `needs-input`. Each event individually toggleable via env so "start" can be silenced if noisy.
- Payload content: project/folder name (from cwd), best-effort summary of the last assistant message (read from transcript), best-effort duration (start timestamp cached per session_id), timestamp, event type.
- Hook MUST always exit 0 — a down gateway or any error never blocks Claude Code.

### Content of notifications
- Include: event type (start/end/needs-input), project/folder name, summary of last response, duration, timestamp.

---

## Agent's Discretion

- Exact queue/retry tuning (attempt count, backoff curve) — sensible defaults, overridable by env.
- Config file format details (env vars vs `.env` vs small YAML) — leaning env/`.env` for Docker friendliness.
- Truncation limits per channel — set to each channel's documented max.
- Repo name `notify-hub` — reversible; rename freely.
- Internal module layout, validation library (e.g. zod), logging library.

### Declined / Undiscussed Gray Areas → Assumptions

All logged in spec.md → Assumptions & Open Questions. Notably: queue tech (Redis+BullMQ), static-token auth, localhost/LAN trust boundary, config source — all agent defaults, none contradicted by the user.

---

## Specific References

- User explicitly named channels to support: ntfy.sh, Telegram, WhatsApp, e-mail, Slack — and asked to "think of others" → Discord added, generic webhook/Gotify noted as P3.
- User model: "a user with a token, sends a request and it does this" → token→profile fan-out.
- Hosting: "on my machine via docker with a queue" → docker-compose + Redis/BullMQ.
- Content: "start and end too" + project name + summary + duration + time.

---

## Deferred Ideas

- Web dashboard to view/replay notification history.
- Multi-user management UI and per-user channel routing rules.
- Quiet hours / do-not-disturb windows and per-priority routing.
- Message history persistence (DB) and delivery analytics.
- Additional adapters: Gotify, Matrix, Pushover (paid), SMS.
