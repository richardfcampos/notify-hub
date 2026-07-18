# Anonymous Opt-In Telemetry Specification

## Problem Statement

notify-hub is public and growing (README, GitHub topics, MCP registries, community outreach). The maintainer has no visibility into adoption — how many people actually run it, which channels they use. Add anonymous, strictly opt-in, fully-disclosed usage telemetry via PostHog (Cloud, EU region), so every self-hosted instance that explicitly opts in reports a minimal heartbeat back to a PostHog project the maintainer owns.

## Goals

- [ ] Default OFF. Enabling it is an explicit, informed choice (setup script prompt + `.env` flag).
- [ ] The exact set of fields sent is small, enumerated, non-identifying, and documented in one place a user can audit before opting in.
- [ ] Respects the informal cross-tool `DO_NOT_TRACK` convention as a hard kill switch, independent of the project's own flag.
- [ ] Works via PostHog's write-only Project API Key embedded in the public repo (safe by PostHog's own security model — verified, not assumed) so adoption aggregates to the maintainer without requiring every self-hoster to create their own PostHog account.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Any per-instance identifying data (channel instance ids/labels, profile names, tokens, message content, hostnames, IP persistence) | Core privacy commitment — only channel *types* (the closed enum: ntfy/telegram/email/slack/discord/whatsapp/voicemonkey/local-tts/webhook), never instance-specific names |
| Self-hosted PostHog | Researched: full stack (ClickHouse+Kafka+Postgres+Redis+MinIO) is disproportionate for a solo maintainer; PostHog Cloud free tier (1M events/mo) is the sane default |
| Error/crash telemetry, operational metrics (Prometheus/etc.) | Different features (discussed separately); this spec is product-adoption telemetry only |
| Telemetry for the admin UI (browser-side PostHog snippet) | Server-side only (Node SDK); no browser tracking, no cookies, nothing added to the panel's pages |
| Fine-grained event frequency (session duration, per-notification events) | A single low-frequency boot heartbeat is enough for adoption counting; more granularity increases the surface of "what's being tracked" without meaningfully improving adoption insight |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| SDK | `posthog-node` (npm), current API `new PostHog(key, {host}).capture({distinctId, event, properties})`, `await client.shutdown()` before process exit | Verified against current official docs, not assumed | y (researched) |
| Region | `https://eu.i.posthog.com` (EU ingestion host) | Privacy-conscious default for a self-hosted-audience OSS project | n (agent default, easy to override) |
| Anonymity model | Every event sent with `$process_person_profile: false` (PostHog's explicit "don't build a Person profile" flag) -- pure anonymous analytics rows, not a tracked identity | Verified PostHog feature for exactly this use case | y (researched) |
| Anonymous ID | Random UUID generated once, stored in a new SQLite table (`telemetry` -- consistent with "config lives in SQLite" architecture), never derived from anything real (no hostname/IP/MAC) | Consistent with existing DB-as-source-of-truth pattern (AD-016) | n (agent default) |
| Event frequency | Once per process boot (api or worker startup) -- a "heartbeat" | Simple, sufficient for adoption counting; avoids a scheduler (YAGNI) | n (agent default) |
| Payload fields | `version` (package.json), `channelTypesEnabled` (deduplicated array of TYPES only, e.g. `["ntfy","slack"]`), `platform` (`process.platform`) | Minimal, enumerated, auditable | n (agent default, confirm before build) |
| Enable mechanism | `.env` `TELEMETRY_ENABLED=true` (default unset/false); ALSO respects `DO_NOT_TRACK` (any value) as a hard override regardless of `TELEMETRY_ENABLED` | Matches researched prior art (`DO_NOT_TRACK`, `NEXT_TELEMETRY_DISABLED`, `HOMEBREW_NO_ANALYTICS`) | y (researched convention, y user direction) |
| First-boot prompt | `scripts/setup-env.sh` gets one new y/N prompt (default N / Enter = disabled), with the exact field list printed inline before asking | Informed consent at the moment of setup, not a buried default | n (agent default) |
| API key distribution | The write-only PostHog Project API Key IS embedded as the default in the shipped code (`POSTHOG_API_KEY` env var with a baked-in default so forks/self-hosters can redirect to their OWN PostHog project by setting the env var, but out-of-the-box telemetry -- if opted in -- reports to the maintainer's project) | Verified write-only/safe-to-embed security model; enables project-wide adoption counting, the stated goal | y (user's stated goal: know adoption as project grows) |
| Key leak/abuse caveat | Documented, not solved: a write-only key can be used to inject junk events into the maintainer's PostHog project (no read access, no real-data exposure) -- accepted risk, same posture as any public analytics key | Verified via a real reported PostHog GitHub issue, not hypothetical | y (researched, disclosed) |
| Disclosure | New `TELEMETRY.md` at repo root: exact field list, why, where (PostHog EU, link to PostHog's own privacy policy), how to verify (link to the exact source file), how to disable (both env vars) | Full-audit-in-one-place, matches self-hosted community expectations | y (user's own "needs to be documented" framing) |

**Open questions:**
- **Richard must provide his own PostHog Project API Key** (create a free PostHog Cloud EU project, copy its `phc_...` key) before the maintainer-aggregation goal is real -- until then, the feature ships wired but pointing at a placeholder/empty key (telemetry silently no-ops if the key is unset, never blocks or errors).

## User Stories

### P1: Opt-in heartbeat to PostHog ⭐ MVP
**Acceptance Criteria**:
1. WHEN `TELEMETRY_ENABLED` is unset or falsy THEN no network call to PostHog SHALL ever be made.
2. WHEN `DO_NOT_TRACK` is set to any value THEN telemetry SHALL be disabled regardless of `TELEMETRY_ENABLED`.
3. WHEN telemetry is enabled AND the process boots THEN exactly ONE `capture` call SHALL be sent with `distinctId` = the persisted anonymous install UUID, `event: "notify_hub_heartbeat"`, `properties: {version, channelTypesEnabled, platform, $process_person_profile: false}`.
4. WHEN `POSTHOG_API_KEY` is unset/empty THEN the client SHALL no-op (log once at debug level, never throw, never block boot).
5. WHEN the PostHog API is unreachable/errors THEN it SHALL fail silently (logged, never thrown, never blocks or delays the rest of boot).
6. The anonymous install UUID SHALL be generated once and persisted in SQLite; subsequent boots reuse the same UUID.

### P1: Setup-time informed consent ⭐ MVP
1. WHEN `scripts/setup-env.sh` runs THEN it SHALL show the exact fields that would be sent if enabled, then ask y/N (default N).
2. `.env.example` SHALL document `TELEMETRY_ENABLED` and `DO_NOT_TRACK` with the same field list inline.

### P1: Full disclosure doc ⭐ MVP
1. `TELEMETRY.md` SHALL enumerate every field ever sent, name PostHog + region + link to their privacy policy, and give both opt-out mechanisms.
2. README SHALL link to `TELEMETRY.md` with a one-line, unambiguous "opt-in, off by default" statement.

## Edge Cases
- Fresh install with empty DB (no channels yet) → `channelTypesEnabled: []`, not omitted (proves absence, doesn't crash on empty).
- Multiple processes (api + worker) booting → each sends its own heartbeat; acceptable (not deduplicated), documented as a known minor overcount rather than added complexity to suppress it.
- Telemetry code failing for any reason (SDK throw, malformed config) → MUST NOT crash or delay `api`/`worker` boot; wrapped in a top-level try/catch, fire-and-forget.

## Requirement Traceability
| ID | Story | Status |
| -- | ----- | ------ |
| TEL-01 | PostHog client wrapper (opt-in gate, DO_NOT_TRACK, anonymous properties) | Pending |
| TEL-02 | Anonymous install UUID persisted in SQLite | Pending |
| TEL-03 | Boot-time heartbeat wired into api/worker | Pending |
| TEL-04 | setup-env.sh consent prompt + .env.example docs | Pending |
| TEL-05 | TELEMETRY.md + README link | Pending |

## Success Criteria
- [ ] `TELEMETRY_ENABLED` unset → zero network calls (unit-proven via a fake capture client, never a real PostHog call in tests).
- [ ] Enabled with a real key (once Richard supplies one) → a real event appears in his PostHog project, containing ONLY the documented fields.
- [ ] `DO_NOT_TRACK=1` overrides an explicit `TELEMETRY_ENABLED=true`.
