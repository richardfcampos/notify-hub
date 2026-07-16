# DB-backed Named Channel Instances Specification

## Problem Statement

The channel model is 1-per-type: one Slack, one Discord, one ntfy. Users with multiple contexts (e.g. several companies) need **multiple named instances of the same type** — `acme-slack`, `globex-slack`, `pessoal-discord` — each with its own credentials, and each profile choosing which instances it routes to. Config must move from flat `.env` to a real store (SQLite), edited live in the panel with no restart (hot-reload).

## Goals

- [ ] Create N named channel instances of any type; each has an id (slug), a display label, a type, enabled flag, and its own credentials.
- [ ] Each profile selects which channel instances it uses (its default channels); `POST /notify` `channels` references instance ids.
- [ ] Config lives in SQLite; editing in the panel takes effect immediately (hot-reload, no `docker compose` restart).
- [ ] Existing `.env` setup migrates automatically into the DB on first boot — nothing breaks.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Postgres / networked DB | User chose SQLite (embedded, no extra container) |
| Per-channel auth/roles, multi-tenant isolation | Personal tool; profiles are the only scoping |
| Config history/versioning UI | DB file backup covers rollback; no in-app history |
| Editing the `.env` for channels | Channels/profiles move to DB; `.env` keeps infra only (PORT, REDIS_URL, DB_PATH, ADMIN_BIND) |
| New channel TYPES | Same 6 adapters (ntfy/telegram/email/slack/discord/webhook); this is about instances, not types |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| DB engine | SQLite via `better-sqlite3` (sync, mature); Dockerfile build stage adds `python3 make g++` for the native module on alpine | User chose SQLite; sync API ideal for fast config reads | y (engine), n (driver) |
| DB location | `DB_PATH` env, default `/data/notify-hub.db`, on a Docker named volume | Survives container recreate; backup = copy one file | n (agent default) |
| Apply model | Hot-reload: gateway/worker read config through the repository per request/job (SQLite reads are cheap + local) | User chose hot-reload; no restart | y |
| Channel identity | `id` (slug, immutable, used in API + profile refs) + `label` (free display text, editable) | User chose name + separate label | y |
| Config storage per instance | JSON column `config` on the channel row (key→value map matching the type's requiredConfig) | Simplest; validated on write | n (agent default) |
| Fail-fast semantics | Moves from startup to write-time (admin rejects an enabled instance missing required config) + send-time (misconfigured instance errors gracefully, isolated) | Dynamic config can't fail-fast at boot; better UX | n (agent default) |
| Migration | On boot, if `channels` table empty, seed from the existing `.env` (legacy singletons → instances named by type; TOKENS → a profile) | Zero-friction upgrade | n (agent default) |
| Secrets at rest | SQLite file on the mounted volume, same trust posture as the old `.env` (localhost/tailnet, file perms) | Consistent with prior model | n (agent default) |

**Open questions:** none — all resolved or logged above.

## User Stories

### P1: Named channel instances (CRUD) ⭐ MVP
**Acceptance Criteria**:
1. WHEN the operator adds a channel with a type, a unique id, a label and the type's required config THEN it SHALL be persisted in SQLite and become usable immediately (no restart).
2. WHEN an instance id collides with an existing one THEN the write SHALL be rejected naming the conflict.
3. WHEN an instance is edited/deleted/toggled THEN the change SHALL persist and take effect on the next send with no restart.
4. WHEN an enabled instance is missing a required config key THEN the write SHALL be rejected naming the instance + key (write-time fail-fast).

**Independent Test**: Add two slack instances with different webhooks → both listed, both persist across a container recreate; duplicate id → rejected.

### P1: Per-profile channel selection ⭐ MVP
**Acceptance Criteria**:
1. WHEN a profile is configured THEN it SHALL reference a set of channel instance ids as its default channels.
2. WHEN a profile default references a disabled or non-existent instance THEN the write SHALL be rejected (or the reference pruned) — a profile default is always a subset of existing enabled instances.
3. WHEN `POST /notify` omits `channels` THEN the token's profile default instances SHALL be used; WHEN it specifies `channels` THEN those instance ids SHALL be used (intersected with enabled instances).

**Independent Test**: Profile "Acme" defaults [acme-slack]; profile "Globex" defaults [globex-slack]; a notification with each token lands only on that company's slack.

### P1: Hot-reload from DB ⭐ MVP
**Acceptance Criteria**:
1. WHEN config changes in the DB THEN the very next `POST /notify` SHALL use the new config with no process restart (the worker builds the adapter per delivery from the instance's current DB config).
2. WHEN a delivery targets an instance THEN the worker SHALL load that instance's type + config from the repository at delivery time (read-through), build the adapter via the type registry, and send.

**Independent Test**: Send → change a webhook in the panel → send again → second send hits the new webhook, no restart.

### P1: SQLite persistence + auto-migration ⭐ MVP
**Acceptance Criteria**:
1. WHEN the service starts with an empty DB and a legacy `.env` present THEN it SHALL seed the DB from the `.env` (each enabled channel → an instance named by its type with a readable label; TOKENS → profiles with their default channels).
2. WHEN the service starts with a populated DB THEN it SHALL NOT re-seed (idempotent).
3. WHEN the DB file does not exist THEN it SHALL be created with the schema.

### P1: Admin panel manages instances (no Apply step) ⭐ MVP
**Acceptance Criteria**:
1. WHEN the panel loads THEN it SHALL list channel instances (label, id, type, enabled) with per-instance config fields (masked + reveal), Send test, and Delete, plus an "Add channel" flow (pick type → id + label → config).
2. WHEN the operator saves THEN the change SHALL be written to the DB and be live immediately — there SHALL be no `docker compose` apply/restart step.
3. WHEN profiles are edited THEN each profile's default-channel chips SHALL list the named instances; selecting/deselecting persists to the DB.
4. WHEN "Send test" runs on an instance THEN it SHALL POST to the gateway targeting that instance id and show the real per-instance outcome.

## Edge Cases
- WHEN an instance id is not a safe slug (spaces/symbols) THEN the write SHALL reject or normalize it (documented).
- WHEN two instances of the same type exist THEN each keeps its own config; deleting one never affects the other.
- WHEN a delivery targets a now-deleted/disabled instance THEN it SHALL be a logged no-op/skip, other channels unaffected.
- WHEN the DB is locked/busy THEN reads SHALL use WAL + a short busy timeout; a failed read errors that send without crashing the process.
- WHEN migrating, a `.env` channel with missing creds SHALL seed as a disabled instance (not block boot).

## Requirement Traceability
| ID | Story | Status |
| -- | ----- | ------ |
| DBCH-01 | SQLite bootstrap + schema + migrations | Pending |
| DBCH-02 | Channel + Profile repositories (Ports & Adapters) | Pending |
| DBCH-03 | Seed-from-.env-if-empty migration | Pending |
| DBCH-04 | Type-keyed registry + per-instance adapter build | Pending |
| DBCH-05 | Delivery read-through from DB (hot-reload) | Pending |
| DBCH-06 | Dispatch resolves instance ids ∩ enabled | Pending |
| DBCH-07 | API: token→profile from DB, /notify + /channels by instance id | Pending |
| DBCH-08 | Admin API CRUD backed by DB, write-time validation, no compose-apply | Pending |
| DBCH-09 | Admin UI: instance management + per-profile selection, live save | Pending |
| DBCH-10 | Docker volume + docs + live migration + smoke | Pending |

## Success Criteria
- [ ] Two companies, two slack instances, two profiles → each token notifies only its company's slack, proven live.
- [ ] Change config in the panel → next send reflects it with no restart.
- [ ] Existing setup migrates on first boot with zero manual steps.
- [ ] Full suite green with a temp-file SQLite DB — no Docker needed for unit/integration tests.
