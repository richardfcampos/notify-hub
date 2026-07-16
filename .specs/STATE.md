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
| AD-013 | Admin panel = host-side app (`npm run admin`, Fastify on 127.0.0.1:8081 ONLY, no auth); `.env` stays the source of truth (canonical rewrite + timestamped backup, comments not preserved); apply = `docker compose up -d` via CommandRunner port; UI = vanilla dark dashboard, secrets masked client-side with reveal | User decisions (placement/access/visual); keeps AD "config = env, fail-fast"; containers immutable | User — placement aspect superseded by AD-014 |
| AD-014 | Admin ships as a compose service (`docker compose up -d` includes it): container listens 0.0.0.0 internally, host binding pinned to 127.0.0.1 via compose port mapping (test-asserted); Docker socket mounted for apply (`up -d --no-build api worker`, project pinned by compose `name:`); repo dir bind-mounted for atomic .env writes; `ENV_FILE_PATH`/`COMPOSE_DIR`/`NOTIFY_GATEWAY_URL`/`ADMIN_HOST` envs; `npm run admin` kept as dev mode | User: "quero que o docker já tenha ele de pé"; socket mount accepted for personal localhost tool | User — binding aspect superseded by AD-015 |
| AD-015 | Admin host bind = `${ADMIN_BIND:-0.0.0.0}` (explicit template, test-asserted): default reachable from owner's devices (Tailscale `intel:8081`, matching every other service on this host); re-pin via `ADMIN_BIND=127.0.0.1`. Trade-off recorded: no auth on a secrets panel reachable by LAN/tailnet; `ADMIN_PASSWORD` gate = deferred idea | User: "faça aparecer no m1 como os outros projetos, intel:8081"; house convention verified live | User |
| AD-016 | Config store = SQLite (`better-sqlite3`) at `DB_PATH` on a Docker volume; channels + profiles live in the DB, `.env` keeps infra only. SUPERSEDES AD-005/006 (config via env) for channels/profiles | User: "um db"; embedded, no extra container | User |
| AD-017 | Channel model = named INSTANCES: N per type, each `{id (slug), label, type, enabled, config}`; profiles reference instance ids. Registry keyed by TYPE; adapters built per-instance | User: multiple slacks/discords per company, name + label | User |
| AD-018 | Apply = hot-reload: gateway/worker read config through the repository at request/delivery time (no restart). SUPERSEDES AD-013/014 Save&Apply/compose-restart and the startup fail-fast (moves to write-time + send-time) | User chose hot-reload | User |

---

## Handoff

### ⏳ CURRENT WORK (interrupted by session limit 2026-07-16) — Feature 4: db-channels

**WHAT & WHY:** User wants **multiple named channel instances per type** (e.g. several Slack/Discord, one per company), each with its own credentials, and each profile choosing which instances it routes to. Config moves from flat `.env` to **SQLite** (user said "um db"), with **hot-reload** (no restart on save) and each channel having a **name/id + separate label**. See `.specs/features/db-channels/{spec.md,tasks.md}`. Decisions recorded as **AD-016** (SQLite store, supersedes .env-config AD-005/006), **AD-017** (named instances, registry keyed by TYPE), **AD-018** (hot-reload, supersedes AD-013/014 Save&Apply + startup fail-fast).

**PLAN:** 11 tasks (D1-D11) in 4 phases + Verifier. Phase 1 (D1-D3 SQLite foundation) → Phase 2 (D4-D8 gateway rewire to DB + hot-reload) → Phase 3 (D9-D10 admin API+UI rewire) → Phase 4 (D11 docker/docs/migration) → Verifier.

**PROGRESS:**
- [x] **D1 — sqlite bootstrap + schema** — commit `1f25250`, PUSHED. `src/db/database.ts` (openDatabase: WAL + busy_timeout + foreign_keys, creates file/dirs), `src/db/schema-sql.ts` (channels/profiles/profile_channels, idempotent), Dockerfile build+runtime stages `apk add python3 make g++` for better-sqlite3 native module. 7 tests pass, build ok. Added dep `better-sqlite3@^12.11.1` + `@types/better-sqlite3`.
- [ ] **D2 — channel + profile repositories** (Ports & Adapters). NEXT. Ports `ChannelRepository`/`ProfileRepository` in core/ports.ts; `src/db/sqlite-channel-repository.ts` + `sqlite-profile-repository.ts`; `ChannelInstance={id,label,type,enabled,config}`, `ProfileRecord={id,name,token,defaultChannels[]}`; add `FakeChannelRepository`/`FakeProfileRepository` to test/helpers/fakes.ts. Commit msg: `feat(db): channel and profile repositories`.
- [ ] **D3 — seed-from-.env-if-empty** — `src/db/seed-from-env.ts`, takes parsed appConfig (NOT process.env), maps legacy singleton channels→instances (id=type), missing cred→enabled:false, TOKENS→profiles. Idempotent. Commit: `feat(db): seed from legacy .env when empty`.
- [ ] **D4-D8 Phase 2** (gateway): type-keyed registry + per-instance build; delivery reads instance from repo at delivery time (hot-reload); dispatch resolves instance ids ∩ enabled; API token→profile + /notify + /channels by instance id; container/entrypoints open DB + seed, remove startup fail-fast/buildActive.
- [ ] **D9-D10 Phase 3** (admin): DB-backed CRUD (drop /api/apply + compose runner + .env file-store for channels); UI = instance list (add/name/label/type/creds/enable/test/delete) + profiles pick instances, single live Save (no restart).
- [ ] **D11 Phase 4**: compose named volume at /data for the .db, DB_PATH env, README rewrite, live migration of user's setup + smoke.
- [ ] **Verifier** after D11 (author≠verifier): spec-anchored DBCH-01..10 + sensor (hot-reload re-reads, per-profile isolation, dup-id reject, seed idempotency).

**HOW TO RESUME:** dispatch a fullstack-developer phase worker (Sonnet) for **D2→D3** (finish Phase 1), gate `npm run test:unit`, atomic commit each, push. Then Phase 2 worker (D4-D8), Phase 3 (D9-D10), Phase 4 (D11), then Verifier (code-reviewer, Opus). Baseline before this feature: 193 tests (commit de7553f). Existing runtime (api/worker/admin) is STILL on the old .env model and fully working — do not break it until Phase 2 rewires it. Current live stack (docker compose) runs the pre-DB code; user's WhatsApp was REMOVED from their config earlier; their default channel = `slack` (still misconfigured — needs a real Incoming Webhook URL).

**CAVEAT:** part of the D1 worker ran while the Opus safety classifier was unavailable; D1 was re-reviewed here (code read + tests + build) before committing. Re-verify D2+ normally.

---

### Prior features (all COMPLETE & VALIDATED)

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

**Feature 2 — mcp-server: COMPLETE & VALIDATED.** Commits 36f07f0 (GET /channels), 209657e (MCP server + 3 tools), 97d781a (stdio entrypoint + docs). 124 tests pass. Verifier PASS iteration 1 (sensor 5/5 killed). SDK @modelcontextprotocol/sdk@1.29.0. Tools: send_notification, list_channels, check_gateway_health. Register via `clients/mcp/install.md`.
**Amendment 1 (dockerized admin): COMPLETE & VALIDATED.** `docker compose up -d` now brings up the admin service at 127.0.0.1:8081 (host binding pinned in compose, test-asserted); apply from inside the container recreates api/worker via mounted socket without self-kill; repo dir-mounted for atomic .env writes. 193 tests, Verifier PASS iteration 1 (sensor 5/5). Commits 9da9be5, 732f843. Minor follow-up noted in validation.md: extend compose-invariants test to assert the remaining admin service keys.

**Feature 3 — admin-panel: COMPLETE & VALIDATED.** Host-side dark dashboard (`npm run admin` → 127.0.0.1:8081): channels + credentials (masked/reveal), token profiles, Save & Apply (validate → backup → write .env → compose up), per-channel test-send with real worker outcome, status + recent deliveries. 185 tests. Verifier PASS iteration 1 (sensor 5/5 killed; security spot-checks clean). Commits 54a633e..53ffe38.
**Live debugging fixes shipped:** ntfy UTF-8 via JSON publish (4b0bed2); CallMeBot 2xx-error body detection with secret-redacted messages (a8a772d). User's WhatsApp works with phone exactly as CallMeBot activation echoes it (557999957286, no + / no extra 9).
**Lessons:** L-001 candidate (queue reliability tests), L-002 CONFIRMED (entrypoint fail-fast must be testable — recurred in both features), L-003 candidate (schema negative tests).
**Optional follow-ups:** entrypoint spawn tests + priority-enum negative test (accepted minor gaps, see both validation.md); NOTIF-01.4 no-hang assertion; quiet-hours/DND; web dashboard (Deferred Ideas in context.md).
**Open questions:** none.
