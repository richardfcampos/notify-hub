# DB-backed Named Channel Instances — Tasks

**Spec**: `.specs/features/db-channels/spec.md`
**Status**: Phases 1-3 done; Phase 4 (docker/docs/migration) next. — 248 tests (Docker-backed full suite), build ok. See STATE.md CURRENT WORK.
**Design (inline)**: SQLite (`better-sqlite3`) behind repository ports (Ports & Adapters, like the rest). Registry keyed by TYPE; adapters built per-instance from DB config at delivery time (hot-reload). Admin panel edits the DB live (no compose-apply). `.env` keeps infra only. Auto-seed from legacy `.env` on empty DB.

## Test Coverage Matrix

| Layer | Test Type | Coverage Expectation | Location | Command |
| ----- | --------- | -------------------- | -------- | ------- |
| DB bootstrap / schema | unit | schema created idempotently; WAL + busy_timeout set | `src/db/*.test.ts` | `npm run test:unit` |
| Repositories (channel/profile) | unit | CRUD round-trips, duplicate-id reject, resolveByToken, listEnabled — temp-file SQLite | `src/db/*.test.ts` | `npm run test:unit` |
| Seed/migration | unit | seeds from fake env when empty; idempotent when populated; missing-cred → disabled instance | `src/db/*.test.ts` | `npm run test:unit` |
| Registry (by type) + per-instance build | unit | build adapter from instance config; unknown type; decorators applied | `src/channels/*.test.ts` | `npm run test:unit` |
| Dispatch/delivery | unit | resolve instance ids ∩ enabled; read-through build; partial-failure isolation | `src/{dispatch,delivery}/*.test.ts` | `npm run test:unit` |
| API routes | e2e | /notify by instance id (202/400/401), /channels lists instances, token→profile | `src/api/**/*.e2e.test.ts` | `npm run test` |
| Admin API | e2e | CRUD channels/profiles, write-time validation (dup id, missing cred, bad profile ref), test-send by id | `src/admin/**/*.e2e.test.ts` | `npm run test` |
| Admin UI extractable logic | unit | instance add/validation/profile-selection helpers | `src/admin/ui/*.test.js` | `npm run test:unit` |
| Docker / entrypoints / docs | none | build gate + live smoke | — | `npm run build` |

Gates: quick=`npm run test:unit`, full=`npm run test`, build=`npm run build`.

## Execution Plan
```
Phase 1 (DB foundation):   D1 → D2 → D3
Phase 2 (gateway rewire):  D4 → D5 → D6 → D7 → D8
Phase 3 (admin rewire):    D9 → D10
Phase 4 (docker/docs):     D11
```

### D1: SQLite bootstrap + schema ✅
**What**: add `better-sqlite3` dep; `src/db/database.ts` opens DB at `DB_PATH`, sets WAL + busy_timeout, runs idempotent schema migrations. Schema: `channels(id TEXT PK, label TEXT, type TEXT, enabled INTEGER, config TEXT_json, created_at)`, `profiles(id TEXT PK, name TEXT, token TEXT UNIQUE)`, `profile_channels(profile_id, channel_id, PK)`. Dockerfile build stage: `apk add python3 make g++` (native module).
**Requirement**: DBCH-01 · **Tests**: unit (temp file) · **Gate**: quick
**Commit**: `feat(db): sqlite bootstrap and schema`

### D2: Channel + Profile repositories ✅
**What**: ports `ChannelRepository` (list, listEnabled, get, upsert, delete) + `ProfileRepository` (list, get, upsert, delete, resolveByToken, setDefaultChannels) in `src/db/`; SQLite impls + an in-memory fake for tests. `ChannelInstance = {id, label, type, enabled, config}`.
**Requirement**: DBCH-02 · **Tests**: unit · **Gate**: quick
**Commit**: `feat(db): channel and profile repositories`

### D3: Seed-from-env migration ✅
**What**: `src/db/seed-from-env.ts` — if channels table empty and legacy config present, map each enabled `.env` channel → instance {id:type, label:Title(type), type, enabled, config}; missing required cred → enabled:false; TOKENS → profiles + profile_channels. Idempotent (no-op if populated).
**Requirement**: DBCH-03 · **Tests**: unit · **Gate**: quick
**Commit**: `feat(db): seed from legacy .env when empty`

### D4: Type-keyed registry + per-instance build ✅
**What**: refactor `channel-registry.ts` to key by TYPE (`type → {factory, requiredConfig}`); `buildInstance(instance, deps)` → registry[type].factory(instance.config, deps) wrapped in Truncating/Logging decorators. Keep existing adapters unchanged (they already take (config, deps)).
**Requirement**: DBCH-04 · **Tests**: unit · **Gate**: quick
**Commit**: `feat(channels): type-keyed registry and per-instance builder`

### D5: Delivery read-through (hot-reload) ✅
**What**: delivery service loads the instance from `ChannelRepository` at delivery time, builds the adapter, sends; missing/disabled → logged skip; build `DeliveryResult`.
**Requirement**: DBCH-05 · **Tests**: unit · **Gate**: quick
**Commit**: `feat(delivery): per-delivery instance load for hot-reload`

### D6: Dispatch by instance id ✅
**What**: resolve requested instance ids or profile default ids ∩ enabled (from repo); empty → logged no-op; fan out one delivery job per resolved instance id.
**Requirement**: DBCH-06 · **Tests**: unit · **Gate**: quick
**Commit**: `feat(dispatch): resolve named instance ids from db`
**Note**: `DispatchJob` gained `profileId` (authoritative; profile defaults resolved from DB at dispatch time) + optional `profileName` (logs only); additive/versionable.

### D7: API rewire to DB ✅
**What**: token→profile via `ProfileRepository`; `POST /notify` validates `channels` are known instance ids (400 unknown); `GET /channels` returns instances (id,label,type,enabled) + profile defaults. e2e with temp DB.
**Requirement**: DBCH-07 · **Tests**: e2e · **Gate**: full
**Commit**: `feat(api): notify and channels by instance id from db`
**Note**: `GET /channels` shape → `{channels:[{id,label,type,enabled}], defaultChannels:[ids]}`; MCP `list_channels` reformatted for it. `token-resolver` retired from the API path (deleted in D8). `/notify` fails early on non-existent (not disabled) instance ids.

### D8: Container + entrypoints on DB ✅
**What**: `buildContainer` wires DB + repos; api/worker open DB, run seed; remove startup fail-fast/`buildActive` (config now dynamic). Graceful DB close on shutdown.
**Requirement**: DBCH-05,07 · **Tests**: integration (temp DB end-to-end fan-out) · **Gate**: full
**Commit**: `feat(core): wire gateway to sqlite repositories`
**Note**: `loadConfig` added `DB_PATH` (default `./data/notify-hub.db`) and relaxed the channel fail-fast (missing-cred/unknown-type now parse as seed input, never throw). Deleted `channel-builder.ts`+`buildActive` (coverage → `build-instance.test.ts`) and `token-resolver.ts`/`TokenResolver` port (coverage → `ProfileRepository.resolveByToken` + auth e2e). Known limitation: email SMTP is a single shared transport from the seed's email config (per-instance SMTP deferred to admin rewrite); webhook-style channels hot-reload fully.

### D9: Admin API CRUD on DB ✅
**What**: replace `.env` config routes with DB-backed: `GET /api/config` → {channels[], profiles[]}; `PUT /api/config` transactional upsert/delete with write-time validation (dup id, enabled-missing-cred → 400 naming it, profile ref must exist+enabled); `POST /api/test-send {channelId}`; DROP `/api/apply` + compose runner + `.env` file store for channels. Keep `.env` store only if still needed for infra (else remove).
**Requirement**: DBCH-08 · **Tests**: e2e · **Gate**: full
**Commit**: `feat(admin): db-backed config crud with write-time validation`
**Note**: `AdminServerDeps` narrowed to `{channelRepo, profileRepo, http?, commandRunner?, uiDir?, composeDir?, gatewayBaseUrl?, testSendPollAttempts?, testSendPollIntervalMs?, delay?}` -- CommandRunner survives ONLY for worker-log tailing (status/test-send), never config writes. New `src/admin/config-validation.ts` (`validateConfigPayload`) enforces slug id, dup id, unknown type, enabled-missing-config, profile-ref-exists+enabled, dup token -- validate-all-then-write (repo ports have no cross-call transaction, so nothing is written until every check passes). PUT applies an upsert+delete diff against the current repo state. `gateway-client.ts` `buildGatewayContext` no longer takes an `.env`-derived model (token/baseUrl passed directly); `/channels` parsing updated to the instance-object shape. Deleted `admin-config.ts`/`admin-validation.ts`/`env-file-store.ts` + `apply-route.ts` and their tests (coverage replaced by `config-validation.test.ts` + `routes/config-routes.e2e.test.ts`). `src/bin/admin.ts` opens the shared SQLite DB (`openDatabase(DB_PATH)`) instead of an `.env` file.

### D10: Admin UI for instances ✅
**What**: rebuild channel section as instance list (label, id badge, type, enabled toggle, masked config + reveal, Send test, Delete) + "Add channel" (type picker → id + label → config fields for that type); profiles pick named instances (chips); remove the Save&Apply/restart step → single "Save" that's live; keep dirty-tracking. Extract validation/selection helpers as pure testable fns.
**Requirement**: DBCH-09 · **Tests**: unit (helpers) + build · **Gate**: full
**Commit**: `feat(admin): named-instance management ui`
**Note**: added `GET /api/channel-types` (from `requiredConfigByChannel`) so the Add-channel picker never hardcodes the 7 types. Pure helpers (all `.test.js`): `admin-instance-id.js` (slugify/isValidChannelId, mirrors backend's slug regex), `admin-channel-completeness.js` (missing-required-key check for the inline warning), `admin-config-payload.js` (assembles the working state into the exact PUT body, trimming stray config keys), `admin-defaults.js` (prune-on-disable adapted to instance ids, now also prunes deleted instances). Profile chips list ALL instances (not just enabled) by label with id as `title` tooltip. **Fixed** `vitest.config.ts`: its `include` never matched `src/**/*.test.js`, so `admin-defaults.test.js` silently ran 0 assertions since Amendment 1 -- now included, and this phase's new `.test.js` files actually execute under `npm run test:unit`.

### D11: Docker volume + docs + migration + smoke
**What**: compose named volume mounted at `/data` for the SQLite file; `DB_PATH` env; `.env.example` trimmed to infra + note channels live in DB now; README rewrite (DB config, hot-reload, multiple named channels per company, migration note); live smoke: recreate stack → existing setup migrated → add a 2nd slack instance → two profiles route to different slacks → change config, next send reflects it (no restart).
**Requirement**: DBCH-10 · **Tests**: none · **Gate**: build + full
**Commit**: `feat(docker): sqlite volume, docs and migration`

## Validation
Verifier runs after D11 (author ≠ verifier): spec-anchored DBCH-01..10 + discrimination sensor (esp. hot-reload actually re-reads, per-profile isolation, dup-id reject, seed idempotency); writes `.specs/features/db-channels/validation.md`.
