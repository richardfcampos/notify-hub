# Project State — notify-hub

Self-hosted, free, multi-channel notification gateway (Docker + Redis queue). Token-auth `POST /notify` fans out to ntfy / Telegram / Email / Slack / Discord (MVP), WhatsApp/CallMeBot (P2). Global Claude Code hook is the first client.

---

## Decisions Log

| ID | Decision | Rationale | Source |
| --- | -------- | --------- | ------ |
| AD-001 | Stack = Node.js/TypeScript, Fastify (API) + BullMQ (worker/queue) over Redis | Best channel-lib ecosystem; user selected | User |
| AD-002 | WhatsApp channel via CallMeBot (P2) | Free for personal use; user selected | User |
| AD-003 | MVP channels = ntfy, Telegram, Email(SMTP), Slack, Discord | User-named set + Discord added per "think of others" | User |
| AD-004 | Claude hooks installed globally (`~/.claude/settings.json`); events start(`UserPromptSubmit`)+end(`Stop`)+needs-input(`Notification`), each toggleable | User wants start+end+"needs me" across all projects | User |
| AD-005 | Queue = Redis + BullMQ (retry + dead-letter) | Durable, free, standard | Agent default |
| AD-006 | Auth = static Bearer tokens in config, token→profile{defaultChannels} | Single-user personal tool | Agent default |
| AD-007 | Enabled-but-misconfigured channel = fail fast at startup | Prevent silent drops | Agent default |
| AD-008 | Trust boundary = localhost/LAN; no public exposure/TLS in MVP | Personal self-hosted | Agent default |
| AD-009 | Repo name = `notify-hub` | Generic (not Claude-only); reversible | Agent default |
| AD-010 | Architecture = Ports & Adapters (Hexagonal): Strategy channels + Registry-Factory + Decorator cross-cutting, DI composition root | Mockable + one interface + endless pluggability (user ask) | User |
| AD-011 | Queue topology = two-stage (dispatch job → one delivery job per channel); retry/backoff/dead-letter native to BullMQ, per channel | No duplicate sends + per-channel DLQ (Approach 1) | User |
| AD-012 | MCP surface = thin stdio client (official `@modelcontextprotocol/sdk`, TS) over the gateway HTTP API; same repo, `src/mcp/` + `src/bin/mcp.ts`; NOTIFY_URL/NOTIFY_TOKEN env, fail-fast | Reuses gateway auth/queue; no queue coupling in MCP process; user asked "acessível por MCP" | User |

---

## Handoff

**Phase:** Execute — IN PROGRESS. Tasks approved (24 tasks, 5 phases + Verifier). Scope = all (MVP + T22 WhatsApp + T24 webhook).
**Execution mode:** one sub-agent per phase (sequential); per-phase model routing (Sonnet phases 1-3,5; Opus phase 4 + Verifier). Verifier always runs after last task.
**Git:** local repo initialized (`main`); initial commit = planning artifacts. Atomic commit per task. Remote/GitHub deferred per user.
**Test stack:** Vitest (unit/integration/e2e via inject), no real network/Redis in tests.

**Progress:**
- [x] Phase 1 — Foundation (T1-T3) — commits 8b34ee2, e09eac1, 5752920; 6 unit tests pass
- [x] Phase 2 — Channels (T4-T9) — commits 31013e9, 8bd7f7f, fea3cd6, ab9ead7, 35bcb0e, f1e364d; 37 unit tests pass. Per-adapter registry entries (ntfyRegistryEntry…), ChannelBuilder.buildActive static, FetchHttpClient handles string+object bodies. ChannelRegistryEntry gained optional maxLength.
- [x] Phase 3 — Queue/dispatch/delivery (T10-T13) — commits 38eb283, 1cfd815, 3bba4b9, 246118d; 53 unit tests pass. InMemoryQueue.deliveries[] = partial-failure seam. DispatchService({queue,logger,activeChannels,resolveProfile}); DeliveryService({channels:Map,clock,logger}); BullMqQueue({redisUrl,retry}). Added package.json overrides.ioredis=$ioredis (BullMQ TS fix).
- [x] Phase 4 — API + wiring + integration (T14-T18) — commits f7a0162, ec7ad20, 4ad862b, 6a019c4, fd4bd75; 79 tests pass (unit+e2e+integration). buildContainer(config,overrides?)→{queue,buildServerDeps(),registerWorkers(),close()}. channel-registry.ts exports channelRegistry + requiredConfigByChannel (ntfy/telegram/email/slack/discord). Fan-out integration test proves partial-failure isolation. ⚠️ BUILD PATH: tsconfig rootDir="." emits dist/src/bin/*.js but start scripts point to dist/bin/*.js — Phase 5 (T19 docker) MUST reconcile. /health is unauthenticated (for compose healthcheck).
- [x] Phase 5 — Docker + hook + docs + T22/T24 (T19-T24) — commits 9d04f8a, e67b5a6, d3f8bdb, 7ed2ca0, 2b5b1ee, 547e54c; 106 tests pass. tsconfig rootDir=src→dist/bin/*.js. REAL docker smoke PASSED (health 200 redis:true, /notify 202, ntfy delivery confirmed on ntfy.sh side). vitest include gained clients/**/*.test.mjs.
- [x] Verifier — iteration 1 FAIL (NOTIF-02 retry/DLQ uncovered) → fix (959fa38 dedupKey wiring, 91c2a91 Redis integration test) → iteration 2 **PASS ✅**. Sensor: 7+3 mutants injected, all killed. Lesson L-001 recorded.

**FEATURE COMPLETE & VALIDATED.** All P1 + P2 (WhatsApp/CallMeBot) + P3 (generic webhook) delivered. 109 automated tests pass (Docker-backed full suite) + real docker smoke confirmed end-to-end (ntfy delivery verified on ntfy.sh side). Build clean.

**Phase 1 notes:** ESM + TS, Vitest. TOKENS format = `name:token:ch1,ch2` entries separated by `;`. Deps bumped for security: nodemailer@9.0.3, vitest@4.1.10 (npm audit clean).

**Remote:** published — https://github.com/richardfcampos/notify-hub (public, `main` tracks `origin/main`).
**Optional follow-ups:** wire NOTIF-01.4 no-hang timeout assertion (accepted spec-precision), quiet-hours/DND, web dashboard (Deferred Ideas in context.md).
**Open questions:** none.
