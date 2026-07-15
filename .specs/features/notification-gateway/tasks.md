# Notification Gateway Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/notification-gateway/design.md`
**Status**: In Progress

---

## Test Coverage Matrix

> Generated from spec + design; greenfield repo. Guidelines found: **none** — strong defaults applied. Proposed test stack: **Vitest** (unit + integration + Fastify `inject` for e2e), zero real network/Redis in tests (FakeHttpClient / FakeMailTransport / InMemoryQueue / FakeClock).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Domain services (config-loader, channel-builder, dispatch, delivery, resolveChannels, token-resolver, notify-schema, decorators) | unit | All branches; 1:1 to spec ACs; every listed edge case | `src/**/*.test.ts` | `npm run test:unit` |
| Channel adapters (ntfy/telegram/email/slack/discord/whatsapp) | unit | Happy + error (4xx/5xx/timeout) + truncation | `src/channels/adapters/*.test.ts` | `npm run test:unit` |
| Queue — InMemoryQueue | unit | enqueue→handler runs; health | `src/queue/in-memory-queue.test.ts` | `npm run test:unit` |
| Queue — BullMQ adapter | none (integration) | No unit; behavior verified by docker smoke (`/health` + real send) | — | build gate + smoke |
| API routes (`/notify`, `/health`) | e2e | All routes: 202 + 400 + 401 + 503; health 200 | `src/api/**/*.e2e.test.ts` | `npm run test` |
| Container wiring / fan-out | integration | End-to-end fan-out + partial-failure isolation via InMemoryQueue + fakes | `test/integration/*.test.ts` | `npm run test` |
| Claude Code hook client | unit | Event map; payload; exit-0 on gateway error; missing transcript/start-time | `clients/claude-code/*.test.mjs` | `npm run test` |
| Scaffold / types / entrypoints / Dockerfile / compose / docs | none | Build gate only | — | `npm run build` |

## Parallelism Assessment

> Generated from design; greenfield.

| Test Type | Parallel-Safe? | Isolation Model | Evidence |
| --------- | -------------- | --------------- | -------- |
| unit | Yes | Fully mocked; per-test FakeHttpClient / FakeMailTransport / FakeClock instances; no shared store | Adapters + services take injected deps (design: Ports & Adapters) |
| e2e (Fastify inject) | Yes | Per-test Fastify app built with injected deps; no real listener/Redis | `server.ts` accepts injected deps |
| integration | Yes | Per-test container with InMemoryQueue (own instance) | `in-memory-queue.ts` is per-instance state |

All test types are parallel-safe → Vitest default file parallelism is fine; `[P]` tasks limited only by code dependencies.

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `npm run test:unit` |
| Full | After tasks with e2e/integration tests | `npm run test` |
| Build | After config/entity/scaffold/docs-only tasks or phase completion | `npm run build && npm run test` |

---

## Execution Plan

### Phase 1: Foundation (Sequential)
```
T1 → T2 → T3
```

### Phase 2: Channel framework + adapters
```
T3 → T4 → ┌ T5 [P] ┐
          ├ T6 [P] │
          ├ T7 [P] ├→ (phase done)
          ├ T8 [P] │
          └ T9 [P] ┘
```

### Phase 3: Queue + dispatch + delivery
```
T2 → T10 → ┌ T11 [P] ┐
           ├ T12 [P] ├→ (phase done)   (T12 also needs T4)
           └ T13 [P] ┘
```

### Phase 4: API + wiring + entrypoints
```
┌ T14 [P] ┐
│ T15 [P] ├→ T16 → T17 → T18
```
(T16 needs T10,T14,T15; T17 needs T3,T4,T5–T9,T11,T12,T13,T16; T18 needs T17,T13)

### Phase 5: Deploy + client + docs
```
T18 → T19 ┐
T2  → T20 ├→ T21 → T23
          └ (T22 [P2 opt], T24 [P3 opt] depend on T4)
```

---

## Task Breakdown

### T1: Project scaffold ✅
**What**: Node/TS project skeleton — `package.json` (scripts: `build`,`test`,`test:unit`,`start:api`,`start:worker`), `tsconfig.json`, `vitest.config.ts`, dir tree (`src/`, `test/`, `clients/`), `.gitignore`, `.env.example` (all env keys), `.dockerignore`.
**Where**: repo root + `src/`, `test/`
**Depends on**: None
**Requirement**: NOTIF-12 (partial)
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [x] `npm install` succeeds; `npm run build` (tsc noEmit or emit) passes with no errors
- [x] `.env.example` lists every env key referenced by design (PORT, REDIS_URL, TOKENS, CHANNELS_ENABLED, per-channel creds, RETRY_*)
- [x] `.gitignore` excludes `.env`, `node_modules`, `dist`
**Tests**: none · **Gate**: build
**Commit**: `chore: scaffold notify-hub project`

### T2: Domain types + port interfaces ✅
**What**: All TS contracts — `Notification`, `DeliveryResult`, `Priority`, `Profile`, `AppConfig`, `DispatchJob`, `DeliveryJob`, `NotificationChannel`, `ChannelDeps`, `ChannelFactory`, `ChannelRegistryEntry`, and ports `HttpClient`, `MailTransport`, `QueuePort`, `TokenResolver`, `Clock`, `Logger`.
**Where**: `src/core/types.ts`, `src/core/ports.ts`
**Depends on**: T1
**Requirement**: NOTIF-01,03,11 (contracts)
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [x] All interfaces from design "Core Interfaces" exported
- [x] `npm run build` passes; no `any` on public contracts
**Tests**: none · **Gate**: build
**Commit**: `feat(core): define domain types and ports`

### T3: Config loader (zod + fail-fast) ✅
**What**: `loadConfig(env, requiredConfigByChannel)` — parse/validate env → `AppConfig`; parse `TOKENS` into profiles; fail fast with channel+key name when an enabled channel lacks a required credential.
**Where**: `src/config/load-config.ts` (+ `.test.ts`)
**Depends on**: T2
**Requirement**: NOTIF-10, NOTIF-11
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [x] Enabled channel missing a required key → throws Error naming channel + key (AC NOTIF-10.2)
- [x] Unknown channel in `CHANNELS_ENABLED` → throws
- [x] `TOKENS` parsed into `Profile[]` with `defaultChannels`
- [x] Happy path returns typed `AppConfig`
- [x] Unit tests cover all above; `npm run test:unit` passes; test count recorded
**Tests**: unit · **Gate**: quick
**Commit**: `feat(config): env loader with fail-fast channel validation`

### T4: Channel builder + decorators + test fakes ✅
**What**: `ChannelBuilder.buildActive(registry, enabled, channelConfig, deps)` (unknown→throw, missing cred→throw, factory→wrap decorators→Map); `TruncatingChannel`, `LoggingChannel`; shared test fakes `FakeHttpClient`, `FakeMailTransport`, `FakeClock`, `FakeLogger`.
**Where**: `src/channels/channel-builder.ts`, `src/channels/decorators/truncating-channel.ts`, `src/channels/decorators/logging-channel.ts`, `test/helpers/fakes.ts` (+ `.test.ts`)
**Depends on**: T2, T3
**Requirement**: NOTIF-03, NOTIF-10
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [x] Unknown channel name → throws; missing-cred → throws naming key
- [x] `TruncatingChannel` truncates to configured limit then delegates
- [x] `LoggingChannel` logs attempt+outcome and delegates (does not swallow throws)
- [x] Fakes usable by adapter tests
- [x] Unit tests cover build cases + both decorators; `npm run test:unit` passes
**Tests**: unit · **Gate**: quick
**Commit**: `feat(channels): registry builder + decorators + test fakes`

### T5: ntfy adapter [P] ✅
**What**: `NtfyChannel implements NotificationChannel` — POST publish to `NTFY_URL`/topic with title/message/priority/tags via injected `HttpClient`; register entry (`requiredConfig: NTFY_URL, NTFY_TOPIC`).
**Where**: `src/channels/adapters/ntfy-channel.ts` (+ `.test.ts`)
**Depends on**: T4
**Requirement**: NOTIF-05
**Tools**: MCP: `context7`/`docs-seeker` (verify ntfy publish API) · Skill: NONE
**Done when**:
- [x] Sends correct URL + headers + body (assert via FakeHttpClient)
- [x] Non-2xx response → throws
- [x] Unit tests: happy + 5xx + timeout; `npm run test:unit` passes
**Tests**: unit · **Gate**: quick
**Commit**: `feat(channels): ntfy adapter`

### T6: Telegram adapter [P] ✅
**What**: `TelegramChannel` — POST Bot API `sendMessage` to `TELEGRAM_CHAT_ID`; register (`requiredConfig: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID`).
**Where**: `src/channels/adapters/telegram-channel.ts` (+ `.test.ts`)
**Depends on**: T4
**Requirement**: NOTIF-06
**Tools**: MCP: `context7`/`docs-seeker` (Telegram Bot API) · Skill: NONE
**Done when**:
- [x] Correct `sendMessage` URL+payload (FakeHttpClient); non-2xx → throws
- [x] Unit tests: happy + error; `npm run test:unit` passes
**Tests**: unit · **Gate**: quick
**Commit**: `feat(channels): telegram adapter`

### T7: Email adapter + nodemailer transport [P] ✅
**What**: `EmailChannel` using injected `MailTransport`; `NodemailerTransport` impl wrapping nodemailer (SMTP from env). Register (`requiredConfig: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_TO`).
**Where**: `src/channels/adapters/email-channel.ts`, `src/transports/nodemailer-transport.ts` (+ `email-channel.test.ts`)
**Depends on**: T4
**Requirement**: NOTIF-07
**Tools**: MCP: `context7`/`docs-seeker` (nodemailer) · Skill: NONE
**Done when**:
- [x] `EmailChannel.send` calls `MailTransport.send` with correct to/subject/text (FakeMailTransport); transport error → throws
- [x] Unit tests: happy + error; `npm run test:unit` passes
**Tests**: unit · **Gate**: quick
**Commit**: `feat(channels): email (SMTP) adapter`

### T8: Slack adapter [P] ✅
**What**: `SlackChannel` — POST to `SLACK_WEBHOOK_URL` incoming webhook. Register (`requiredConfig: SLACK_WEBHOOK_URL`).
**Where**: `src/channels/adapters/slack-channel.ts` (+ `.test.ts`)
**Depends on**: T4
**Requirement**: NOTIF-08
**Tools**: MCP: `context7`/`docs-seeker` (Slack incoming webhook) · Skill: NONE
**Done when**:
- [x] Correct webhook payload (FakeHttpClient); non-2xx → throws
- [x] Unit tests: happy + error; `npm run test:unit` passes
**Tests**: unit · **Gate**: quick
**Commit**: `feat(channels): slack adapter`

### T9: Discord adapter [P] ✅
**What**: `DiscordChannel` — POST to `DISCORD_WEBHOOK_URL` incoming webhook. Register (`requiredConfig: DISCORD_WEBHOOK_URL`).
**Where**: `src/channels/adapters/discord-channel.ts` (+ `.test.ts`)
**Depends on**: T4
**Requirement**: NOTIF-09
**Tools**: MCP: `context7`/`docs-seeker` (Discord webhook) · Skill: NONE
**Done when**:
- [x] Correct webhook payload (FakeHttpClient); non-2xx → throws
- [x] Unit tests: happy + error; `npm run test:unit` passes
**Tests**: unit · **Gate**: quick
**Commit**: `feat(channels): discord adapter`

### T10: InMemoryQueue (QueuePort) ✅
**What**: `InMemoryQueue implements QueuePort` — synchronous handler invocation, health()=true, records jobs; test double for the whole pipeline.
**Where**: `src/queue/in-memory-queue.ts` (+ `.test.ts`)
**Depends on**: T2
**Requirement**: NOTIF-02 (test seam)
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [x] `enqueueDispatch`/`enqueueDelivery` invoke registered handlers; returns jobId
- [x] `health()` → true; Unit tests pass
**Tests**: unit · **Gate**: quick
**Commit**: `feat(queue): in-memory queue adapter`

### T11: Dispatch service [P] ✅
**What**: `resolveChannels(profile, requested?, active)` + `handleDispatch(job)` → enqueue one delivery job per resolved channel; empty set → logged no-op.
**Where**: `src/dispatch/dispatch-service.ts` (+ `.test.ts`)
**Depends on**: T2, T10
**Requirement**: NOTIF-03
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [x] resolve: requested∩active; default∩active; empty → []
- [x] handleDispatch enqueues N delivery jobs (assert via InMemoryQueue)
- [x] empty set → no enqueue + warn log (NOTIF-03.4)
- [x] Unit tests cover all; `npm run test:unit` passes
**Tests**: unit · **Gate**: quick
**Commit**: `feat(dispatch): channel resolution + fan-out`

### T12: Delivery service [P] ✅
**What**: `deliver(job)` → `registry channel.send(notification)`; success = resolve; failure = throw (so queue retries); build `DeliveryResult` with attempts/durationMs via `Clock`.
**Where**: `src/delivery/delivery-service.ts` (+ `.test.ts`)
**Depends on**: T2, T4
**Requirement**: NOTIF-02, NOTIF-04
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [x] Success path resolves; channel throw propagates (for retry)
- [x] `DeliveryResult` shape correct (channel, ok, error, attempts, durationMs)
- [x] Unit tests: success + failure; `npm run test:unit` passes
**Tests**: unit · **Gate**: quick
**Commit**: `feat(delivery): single-channel delivery service`

### T13: BullMQ queue adapter [P] ✅
**What**: `BullMqQueue implements QueuePort` — two queues (dispatch, delivery) + workers; job opts `attempts`/`backoff`; failed→dead-letter; `health()` pings Redis.
**Where**: `src/queue/bullmq-queue.ts`
**Depends on**: T2, T10
**Requirement**: NOTIF-02
**Tools**: MCP: `context7`/`docs-seeker` (BullMQ retry/backoff/DLQ) · Skill: NONE
**Done when**:
- [x] Implements `QueuePort`; two queues + workers wired with retry/backoff
- [x] Exhausted retries land in a failed/dead-letter set (not dropped)
- [x] `npm run build` passes (behavior verified by Phase 5 smoke — no unit test per matrix)
**Tests**: none (integration via smoke) · **Gate**: build
**Commit**: `feat(queue): bullmq adapter with retry + dead-letter`

### T14: Token resolver [P]
**What**: `TokenResolver` from `AppConfig.profiles` — known token → profile, unknown → null.
**Where**: `src/auth/token-resolver.ts` (+ `.test.ts`)
**Depends on**: T2
**Requirement**: NOTIF-11
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] Known token → profile; unknown/undefined → null
- [ ] Unit tests pass
**Tests**: unit · **Gate**: quick
**Commit**: `feat(auth): token→profile resolver`

### T15: Notify request schema (zod) [P]
**What**: zod schema for `/notify` body + a validator returning typed payload or field errors; unknown channel name → invalid.
**Where**: `src/api/schemas/notify-schema.ts` (+ `.test.ts`)
**Depends on**: T2
**Requirement**: NOTIF-01
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] Valid body parses; missing/empty `message` → error; unknown `channels` entry → error; wrong types → error
- [ ] Unit tests cover all; `npm run test:unit` passes
**Tests**: unit · **Gate**: quick
**Commit**: `feat(api): notify request schema`

### T16: Fastify server + routes + auth
**What**: `buildServer(deps)` with Bearer auth preHandler (TokenResolver), `POST /notify` (validate→resolve→enqueueDispatch→202/jobId; 400/401; 503 on enqueue failure), `GET /health` (QueuePort.health).
**Where**: `src/api/server.ts`, `src/api/routes/notify.ts`, `src/api/routes/health.ts`, `src/api/plugins/auth.ts` (+ `*.e2e.test.ts`)
**Depends on**: T10, T14, T15
**Requirement**: NOTIF-01, NOTIF-14
**Tools**: MCP: `context7`/`docs-seeker` (Fastify) · Skill: NONE
**Done when**:
- [ ] e2e via `app.inject`: valid+token→202+jobId; bad token→401; missing message→400; unknown channel→400; queue down→503; `/health`→200 redis:ok
- [ ] Server built with injected deps (InMemoryQueue + fake resolver in tests)
- [ ] `npm run test` passes
**Tests**: e2e · **Gate**: full
**Commit**: `feat(api): notify + health routes with token auth`

### T17: Composition root + end-to-end integration
**What**: `buildContainer(config, overrides?)` wiring config→registry(all adapters)→queue→dispatch/delivery/token services→server; integration test that drives POST /notify through InMemoryQueue to fake channels, asserting fan-out + partial-failure isolation (one channel throws, others deliver, per-channel results).
**Where**: `src/container.ts`, `src/channels/channel-registry.ts` (assembles adapter entries), `test/integration/fan-out.test.ts`
**Depends on**: T3, T4, T5, T6, T7, T8, T9, T11, T12, T13, T16
**Requirement**: NOTIF-03, NOTIF-04
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] Container builds active channels from config; overrides inject fakes/InMemoryQueue
- [ ] Integration test: send to 2+ channels, one fails → others still delivered, results recorded (NOTIF-04)
- [ ] `npm run test` passes
**Tests**: integration · **Gate**: full
**Commit**: `feat(core): composition root + fan-out integration`

### T18: Entrypoints (api + worker)
**What**: `src/bin/api.ts` (load config → buildContainer → start Fastify + dispatch producer), `src/bin/worker.ts` (buildContainer → register dispatch + delivery workers).
**Where**: `src/bin/api.ts`, `src/bin/worker.ts`
**Depends on**: T17, T13
**Requirement**: NOTIF-12
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] Both build and start against config; graceful shutdown closes queue
- [ ] `npm run build` passes
**Tests**: none · **Gate**: build
**Commit**: `feat(bin): api and worker entrypoints`

### T19: Dockerfile + docker-compose
**What**: `Dockerfile` (shared image), `docker-compose.yml` (`redis`, `api`, `worker` reading `.env`), healthcheck on api.
**Where**: `Dockerfile`, `docker-compose.yml`
**Depends on**: T18
**Requirement**: NOTIF-12
**Tools**: MCP: NONE · Skill: `deploy`/`devops` (optional) · NONE required
**Done when**:
- [ ] `docker compose config` valid; three services defined; api depends_on redis
- [ ] (Smoke in T23) `docker compose up` → `/health` 200
**Tests**: none · **Gate**: build
**Commit**: `feat(docker): compose stack (redis + api + worker)`

### T20: Claude Code hook client [P]
**What**: `notify-hook.mjs` (zero-dep) — read hook JSON stdin, map `hook_event_name`→event (toggle via env), build payload (project=basename cwd, summary=last assistant msg from transcript best-effort, duration=now−cached start best-effort, timestamp), POST to gateway with token; **always exit 0**; cache start-time per session_id.
**Where**: `clients/claude-code/notify-hook.mjs` (+ `notify-hook.test.mjs`)
**Depends on**: T2
**Requirement**: NOTIF-13
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] Stop→event=end payload; UserPromptSubmit→start; Notification→needs-input; each env-toggle respected
- [ ] Gateway error/timeout → exit 0 (never blocks)
- [ ] Missing transcript/start-time → send without that field
- [ ] Tests (node/vitest) assert payload via fake fetch + exit-0 on error; `npm run test` passes
**Tests**: unit · **Gate**: quick
**Commit**: `feat(client): claude code notification hook`

### T21: Hook install docs + settings snippet
**What**: `install.md` — global `~/.claude/settings.json` hook config (UserPromptSubmit/Stop/Notification → the mjs), env setup (`NOTIFY_URL`, `NOTIFY_TOKEN`, event toggles), troubleshooting.
**Where**: `clients/claude-code/install.md`, `clients/claude-code/.env.example`
**Depends on**: T20
**Requirement**: NOTIF-13
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] Copy-pasteable settings.json snippet for global install
- [ ] Env keys documented
**Tests**: none · **Gate**: build
**Commit**: `docs(client): claude code hook install guide`

### T22: WhatsApp (CallMeBot) adapter — P2 (optional)
**What**: `WhatsAppChannel` via CallMeBot API (`WHATSAPP_PHONE`, `WHATSAPP_APIKEY`); register.
**Where**: `src/channels/adapters/whatsapp-channel.ts` (+ `.test.ts`)
**Depends on**: T4
**Requirement**: NOTIF-15
**Tools**: MCP: `docs-seeker` (CallMeBot) · Skill: NONE
**Done when**:
- [ ] Correct CallMeBot request (FakeHttpClient); non-2xx → throws
- [ ] Unit tests: happy + error + rate-limit; `npm run test:unit` passes
**Tests**: unit · **Gate**: quick
**Commit**: `feat(channels): whatsapp (callmebot) adapter`

### T23: README + final env + end-to-end smoke
**What**: `README.md` (what/why, quickstart `docker compose up`, curl example, channel setup, hook install link), finalize `.env.example`; run the docker smoke (up → `/health` → one real `POST /notify` to a configured channel).
**Where**: `README.md`, `.env.example`
**Depends on**: T19, T21
**Requirement**: All (docs) + NOTIF-12 smoke
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] README covers quickstart + curl + channels + hook
- [ ] Smoke: `docker compose up -d` → `curl /health`=200; one send reaches a real channel (or documented if creds absent)
**Tests**: none · **Gate**: build
**Commit**: `docs: readme + quickstart + smoke`

### T24: Generic webhook adapter — P3 (optional)
**What**: `WebhookChannel` — POST notification JSON to `WEBHOOK_URL`; reference plugin proving extensibility.
**Where**: `src/channels/adapters/webhook-channel.ts` (+ `.test.ts`)
**Depends on**: T4
**Requirement**: NOTIF-16
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] POSTs JSON to configured URL (FakeHttpClient); non-2xx → throws; unit tests pass
**Tests**: unit · **Gate**: quick
**Commit**: `feat(channels): generic webhook adapter`

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1 scaffold | config files | ✅ (cohesive setup) |
| T2 types+ports | 2 type files | ✅ |
| T3 config loader | 1 module | ✅ |
| T4 builder+decorators+fakes | 1 concern (channel framework) | ✅ (cohesive) |
| T5–T9 adapters | 1 adapter each | ✅ |
| T10 InMemoryQueue | 1 class | ✅ |
| T11 dispatch | 1 module | ✅ |
| T12 delivery | 1 module | ✅ |
| T13 BullMQ | 1 adapter | ✅ |
| T14 token resolver | 1 module | ✅ |
| T15 schema | 1 module | ✅ |
| T16 server+routes | 1 concern (HTTP surface) | ✅ (cohesive) |
| T17 container+integration | 1 wiring concern | ✅ |
| T18 entrypoints | 2 thin bins | ✅ |
| T19 docker | compose files | ✅ |
| T20 hook client | 1 script | ✅ |
| T21 hook docs | docs | ✅ |
| T22/T24 optional adapters | 1 adapter each | ✅ |
| T23 readme+smoke | docs+verify | ✅ |

## Diagram-Definition Cross-Check

| Task | Depends On (body) | Diagram | Status |
| ---- | ----------------- | ------- | ------ |
| T1 | none | none | ✅ |
| T2 | T1 | T1→T2 | ✅ |
| T3 | T2 | T2→T3 | ✅ |
| T4 | T3 (,T2) | T3→T4 | ✅ |
| T5–T9 | T4 | T4→T5..T9 [P] | ✅ |
| T10 | T2 | T2→T10 | ✅ |
| T11 | T2,T10 | T10→T11 [P] | ✅ |
| T12 | T2,T4 | T10→T12 [P] (+T4 cross-phase) | ✅ |
| T13 | T2,T10 | T10→T13 [P] | ✅ |
| T14 | T2 | →T16 [P] | ✅ |
| T15 | T2 | →T16 [P] | ✅ |
| T16 | T10,T14,T15 | T14,T15→T16 | ✅ |
| T17 | T3,T4,T5–T9,T11,T12,T13,T16 | T16→T17 (aggregates) | ✅ |
| T18 | T17,T13 | T17→T18 | ✅ |
| T19 | T18 | T18→T19 | ✅ |
| T20 | T2 | T2→T20 [P] | ✅ |
| T21 | T20 | T20→T21 | ✅ |
| T23 | T19,T21 | →T23 | ✅ |
| T22/T24 | T4 | opt | ✅ |

No parallel task depends on another in its own parallel group. ✅

## Test Co-location Validation

| Task | Layer Created | Matrix Requires | Task Says | Status |
| ---- | ------------- | --------------- | --------- | ------ |
| T1 | scaffold | none | none | ✅ |
| T2 | types/ports | none | none | ✅ |
| T3 | domain service | unit | unit | ✅ |
| T4 | domain service | unit | unit | ✅ |
| T5–T9 | adapters | unit | unit | ✅ |
| T10 | queue (in-mem) | unit | unit | ✅ |
| T11 | domain service | unit | unit | ✅ |
| T12 | domain service | unit | unit | ✅ |
| T13 | BullMQ adapter | none (smoke) | none | ✅ |
| T14 | domain service | unit | unit | ✅ |
| T15 | domain service | unit | unit | ✅ |
| T16 | API routes | e2e | e2e | ✅ |
| T17 | container/fan-out | integration | integration | ✅ |
| T18 | entrypoints | none | none | ✅ |
| T19 | docker | none | none | ✅ |
| T20 | hook client | unit | unit | ✅ |
| T21 | docs | none | none | ✅ |
| T22/T24 | adapters | unit | unit | ✅ |
| T23 | docs+smoke | none | none | ✅ |

All ✅ — no test deferral, no violations.

---

## Coverage Summary

16 requirements → all mapped to tasks. P1 = T1–T21 (+T23 smoke). P2 = T22 (WhatsApp). P3 = T24 (webhook). No unmapped requirements.
