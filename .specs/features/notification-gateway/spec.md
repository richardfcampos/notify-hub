# Multi-Channel Notification Gateway Specification

## Problem Statement

When Claude Code (or any tool/script) finishes a task, there's no push to the user's phone/devices — they must watch the terminal. We want a self-hosted, free, token-authenticated notification service (Docker + queue) that fans a single request out to multiple channels (ntfy, Telegram, e-mail, Slack, Discord, WhatsApp), where each channel is independently enable-able. Claude Code hooks are the first client.

## Goals

- [ ] A client can `POST /notify` with a token and get the message delivered to all its enabled channels, asynchronously via a durable queue.
- [ ] Runs 100% free and self-hosted on the user's machine via `docker compose up`.
- [ ] Adding/enabling a new channel is a config toggle + small adapter (pluggable), not a rewrite.
- [ ] Claude Code sends a push on task start, task end, and when it needs the user — globally across all projects — without ever blocking Claude.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| ------- | ------ |
| Web UI / dashboard | MVP is API + config-file only; UI is a future feature |
| Multi-user management UI / DB of users | Tokens & profiles live in config file; no user CRUD |
| Persistent message history / audit DB | Queue holds transient jobs only; history is a future feature |
| Paid channels (Pushover, Twilio SMS) | Requirement is free-only |
| WhatsApp via Baileys / Meta Cloud API | User chose CallMeBot (free, personal) as the WhatsApp path |
| End-to-end payload encryption | Service runs on trusted localhost/LAN; token auth is the boundary |
| Public internet exposure / TLS termination | User's responsibility via their own reverse proxy if they expose it |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Stack | Node.js/TypeScript, Fastify (API), BullMQ (worker/queue) | User selected; best channel-lib ecosystem | y |
| Queue technology | Redis + BullMQ (retries, backoff, dead-letter built-in) | Standard, free, durable; user asked for "a queue" | n (agent default) |
| Auth model | Static Bearer tokens defined in config; token → user profile w/ default channels | Single-user personal tool; OAuth is overkill | n (agent default) |
| Config source | Env vars / `.env` (12-factor) + `CHANNELS_ENABLED` list | Docker-friendly, no secrets in code | n (agent default) |
| Enabled-but-misconfigured channel | Fail fast at startup with a clear error | Prevents silent notification drops | n (agent default) |
| Claude event mapping | start=`UserPromptSubmit`, end=`Stop`, needs-input=`Notification`; each toggleable | User asked for start+end+"needs me"; toggles avoid noise | y (events), n (mapping detail) |
| WhatsApp channel | CallMeBot, priority P2 | User selected; free for personal use | y |
| Discord channel added to MVP | Incoming webhook | User asked to "think of others"; Discord is free+robust | y |
| Network trust boundary | Bind to localhost/LAN, trusted network | Personal self-hosted tool | n (agent default) |
| Repo name | `notify-hub` | Descriptive, generic (service is not Claude-only) | n (reversible) |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Authenticated async notify API ⭐ MVP

**User Story**: As a client (script/hook), I want to POST a message with a token and have it queued and delivered, so that senders are decoupled from delivery and never blocked.

**Why P1**: The core contract everything else depends on.

**Acceptance Criteria**:

1. WHEN a client POSTs `/notify` with a valid Bearer token and a valid body (`title`, `message`, optional `priority`, `tags`, `channels`, `metadata`) THEN system SHALL enqueue one job and respond `202` with a `jobId`.
2. WHEN the Bearer token is missing or unknown THEN system SHALL respond `401` and enqueue nothing.
3. WHEN the body is invalid (missing `message`, unknown `channels` entry, wrong types) THEN system SHALL respond `400` with a validation message and enqueue nothing.
4. WHEN Redis is unreachable at enqueue time THEN system SHALL respond `503` and not hang.

**Independent Test**: `curl -H "Authorization: Bearer <t>"` a valid body → `202`+jobId; bad token → `401`; missing `message` → `400`.

---

### P1: Durable queue with retry + dead-letter ⭐ MVP

**User Story**: As an operator, I want failed sends retried and eventually parked, so transient channel outages don't lose messages and permanent failures don't loop forever.

**Why P1**: "A queue" was an explicit requirement; delivery reliability is the point.

**Acceptance Criteria**:

1. WHEN a job is enqueued THEN a worker SHALL process it asynchronously (API does not send inline).
2. WHEN a channel send fails with a transient error THEN system SHALL retry with exponential backoff up to a configured max attempts.
3. WHEN retries are exhausted for a job THEN system SHALL move it to a failed/dead-letter state (not silently drop) and log the reason.

**Independent Test**: Point a channel at an unreachable endpoint → observe N retry attempts in logs, then a failed job in the dead-letter set.

---

### P1: Multi-channel fan-out with per-request selection ⭐ MVP

**User Story**: As a sender, I want one request to reach several channels, choosing them per-request or falling back to my defaults, so I control reach without multiple calls.

**Why P1**: The "fan-out" is the product.

**Acceptance Criteria**:

1. WHEN a job specifies no `channels` THEN worker SHALL deliver to the token's default enabled channels.
2. WHEN a job specifies `channels` THEN worker SHALL deliver to exactly that set, intersected with globally-enabled+configured channels.
3. WHEN one channel fails THEN system SHALL still attempt and deliver the others (partial-failure isolation) and record a per-channel result (`ok`/`error`).
4. WHEN the resolved channel set is empty THEN system SHALL complete the job as a logged no-op (nothing to send).

**Independent Test**: Enable ntfy+discord, send with `channels:["ntfy"]` → only ntfy receives; kill ntfy, send to both → discord still delivers, result shows ntfy=error.

---

### P1: Core channel adapters (ntfy, Telegram, Email, Slack, Discord) ⭐ MVP

**User Story**: As a user, I want the five robust free channels working, so I actually receive pushes on my phone and desktop.

**Why P1**: Without adapters the gateway delivers nothing.

**Acceptance Criteria**:

1. WHEN the ntfy channel is enabled+configured and a job targets it THEN system SHALL publish to the configured ntfy topic (self-hosted or ntfy.sh) with title/message/priority/tags.
2. WHEN the Telegram channel is enabled THEN system SHALL send via Bot API to the configured `chat_id`.
3. WHEN the Email channel is enabled THEN system SHALL send an SMTP email to the configured recipient.
4. WHEN the Slack channel is enabled THEN system SHALL POST to the configured incoming webhook.
5. WHEN the Discord channel is enabled THEN system SHALL POST to the configured incoming webhook.
6. WHEN an adapter receives a message longer than its channel limit THEN it SHALL truncate to fit rather than error.

**Independent Test**: With real creds for each channel, send one notification → each enabled channel receives it.

---

### P1: Config-driven channels + fail-fast validation ⭐ MVP

**User Story**: As an operator, I want to enable only the channels I want and be told immediately if credentials are missing, so I don't discover drops later.

**Why P1**: "enable which I want" was explicit.

**Acceptance Criteria**:

1. WHEN `CHANNELS_ENABLED` lists a channel THEN only listed channels SHALL be active.
2. WHEN a listed channel is missing a required credential THEN the service SHALL refuse to start with a clear message naming the channel and the missing key.
3. WHEN a channel is not listed THEN it SHALL never be attempted even if a job requests it (it is simply absent from the resolved set).

**Independent Test**: Enable `slack` without a webhook URL → service exits at startup with a naming error.

---

### P1: Token → user profile mapping ⭐ MVP

**User Story**: As the user, I want a token tied to a profile with my default channels, so my clients just send and it goes to my devices.

**Why P1**: "a user with a token that sends a request" was explicit.

**Acceptance Criteria**:

1. WHEN a known token is presented THEN system SHALL resolve it to a profile whose `defaultChannels` are used when a request omits `channels`.
2. WHEN an unknown token is presented THEN system SHALL respond `401`.
3. The system SHALL support at least one configured token/profile.

**Independent Test**: Configure token T with defaults [ntfy]; POST without `channels` → delivered to ntfy.

---

### P1: Docker Compose deployment ⭐ MVP

**User Story**: As the user, I want `docker compose up` to bring up the whole thing, so hosting on my machine is one command.

**Why P1**: "hospedagem na minha máquina via docker" was explicit.

**Acceptance Criteria**:

1. WHEN the user runs `docker compose up` THEN `redis`, `api`, and `worker` services SHALL start.
2. WHEN the stack is up THEN `GET /health` SHALL return `200` with an `ok` status and Redis connectivity indicator.
3. WHEN configuration is provided via `.env` THEN all three services SHALL read it.

**Independent Test**: `docker compose up -d` → `curl localhost:PORT/health` returns 200 with redis:ok.

---

### P1: Claude Code hook client ⭐ MVP

**User Story**: As a Claude Code user, I want a global hook that pushes on task start/end and when Claude needs me, so I get notified across every project.

**Why P1**: This is the reason the project exists.

**Acceptance Criteria**:

1. WHEN Claude Code fires `Stop` THEN the hook SHALL POST a notification with `event=end`, project/folder name, a short summary of the last assistant message (best-effort), task duration (best-effort), and timestamp.
2. WHEN Claude Code fires `UserPromptSubmit` THEN the hook SHALL POST with `event=start` (individually toggleable).
3. WHEN Claude Code fires `Notification` (needs permission/input) THEN the hook SHALL POST with `event=needs-input`.
4. WHEN the gateway is down or returns non-2xx or times out THEN the hook SHALL exit 0 (never block or fail Claude Code) and log locally.
5. WHEN the transcript or start-time is unavailable THEN the hook SHALL still send, omitting the missing field.

**Independent Test**: Install hook globally, run a Claude task in any repo → phone receives a "start" then an "end" push naming the project.

---

### P2: WhatsApp channel via CallMeBot

**User Story**: As a user, I want WhatsApp pushes too, so I get them where I already chat.

**Why P2**: Free but rate-limited/personal; not required for first delivery.

**Acceptance Criteria**:

1. WHEN the WhatsApp channel is enabled with a CallMeBot phone+apikey and a job targets it THEN system SHALL send the message via the CallMeBot API.
2. WHEN CallMeBot rate-limits or errors THEN it SHALL follow the same retry/dead-letter path as other channels (partial-failure isolation preserved).

**Independent Test**: Enable whatsapp with a valid CallMeBot key → send → message arrives on WhatsApp.

---

### P3: Extensibility — generic webhook adapter + plugin docs

**User Story**: As a tinkerer, I want to add arbitrary channels (generic webhook, Gotify, etc.) by dropping in an adapter, so the gateway grows without core changes.

**Why P3**: Nice-to-have; the adapter interface already enables it.

**Acceptance Criteria**:

1. WHEN a developer adds an adapter implementing the channel interface and lists it in `CHANNELS_ENABLED` THEN it SHALL participate in fan-out with no core changes.
2. A generic `webhook` adapter (POST JSON to a configured URL) SHALL be provided as the reference example.

---

## Edge Cases

- WHEN `message` is empty/whitespace THEN system SHALL respond `400`.
- WHEN `channels` contains an unknown name THEN system SHALL respond `400` (fail early, don't enqueue a partially-valid job).
- WHEN all resolved channels are disabled THEN job SHALL complete as a logged no-op.
- WHEN a single channel adapter throws THEN other channels SHALL be unaffected and the job records per-channel status.
- WHEN a message exceeds a channel's length limit THEN the adapter SHALL truncate.
- WHEN the hook runs but the gateway is unreachable THEN the hook SHALL never non-zero-exit into Claude Code.
- WHEN two identical jobs arrive (client retry) THEN an optional `dedupKey` SHALL collapse them via BullMQ jobId (best-effort).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| NOTIF-01 | P1: Notify API | Design | Pending |
| NOTIF-02 | P1: Durable queue | Design | Pending |
| NOTIF-03 | P1: Fan-out selection | Design | Pending |
| NOTIF-04 | P1: Partial-failure isolation | Design | Pending |
| NOTIF-05 | P1: ntfy adapter | Design | Pending |
| NOTIF-06 | P1: Telegram adapter | Design | Pending |
| NOTIF-07 | P1: Email adapter | Design | Pending |
| NOTIF-08 | P1: Slack adapter | Design | Pending |
| NOTIF-09 | P1: Discord adapter | Design | Pending |
| NOTIF-10 | P1: Config + fail-fast | Design | Pending |
| NOTIF-11 | P1: Token→profile | Design | Pending |
| NOTIF-12 | P1: Docker Compose | Design | Pending |
| NOTIF-13 | P1: Claude hook client | Design | Pending |
| NOTIF-14 | P1: Health endpoint | Design | Pending |
| NOTIF-15 | P2: WhatsApp (CallMeBot) | - | Pending |
| NOTIF-16 | P3: Extensibility/webhook | - | Pending |

**ID format:** `NOTIF-[NUMBER]`
**Status values:** Pending → In Design → In Tasks → Implementing → Verified
**Coverage:** 16 total, 0 mapped to tasks yet.

---

## Success Criteria

- [ ] `docker compose up` → healthy stack; one `POST /notify` reaches every enabled channel.
- [ ] A global Claude Code hook pushes start/end/needs-input to the phone across all projects, never blocking Claude.
- [ ] Enabling a new channel is: add creds + list in `CHANNELS_ENABLED` (+ small adapter for a brand-new one).
- [ ] Zero recurring cost; runs entirely on the user's machine.
