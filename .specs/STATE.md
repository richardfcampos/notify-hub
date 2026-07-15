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

---

## Handoff

**Phase:** Design — COMPLETE & APPROVED (Approach 1). Next: Tasks breakdown.
**Next step:** Write `tasks.md` — atomic tasks with verification, grouped into phases; then offer sub-agent delegation (>3 phases) and Execute.

**Artifacts:**
- `.specs/features/notification-gateway/spec.md`
- `.specs/features/notification-gateway/context.md`
- `.specs/features/notification-gateway/design.md` (Approved)

**Open questions:** none — all resolved or logged as assumptions in spec.md.
