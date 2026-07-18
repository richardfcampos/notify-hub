# Anonymous Opt-In Telemetry — Tasks

**Spec**: `.specs/features/telemetry/spec.md`
**Status**: ALL PHASES DONE — pending Verifier
**Design (inline)**: `src/telemetry/` module — `TelemetryClient` port-style wrapper (mirrors the project's Ports & Adapters convention) around `posthog-node`, injectable for tests (a `FakeTelemetryClient` like every other external seam). Wired into `src/bin/api.ts` and `src/bin/worker.ts` boot sequence as a fire-and-forget, try/caught call — never blocks or fails boot. Anonymous UUID persisted via a new tiny SQLite table, read/written through a small repository following the existing `ChannelRepository`/`ProfileRepository` pattern.

## Test Coverage Matrix

| Layer | Test Type | Coverage Expectation | Location | Command |
| ----- | --------- | -------------------- | -------- | ------- |
| Telemetry gating (enabled/DO_NOT_TRACK/no-key) | unit | every disable path → zero capture calls (fake client asserts `.capture` never invoked) | `src/telemetry/*.test.ts` | `npm run test:unit` |
| Heartbeat payload | unit | exact fields asserted (version/channelTypesEnabled/platform/$process_person_profile); empty-channels case | `src/telemetry/*.test.ts` | `npm run test:unit` |
| Install-id repository | unit (temp-file SQLite) | generates once, persists, reused on second open | `src/db/*.test.ts` | `npm run test:unit` |
| Boot wiring (api/worker) | integration/e2e as fits existing container tests | telemetry failure never throws/blocks boot | existing container/integration tests extended | `npm run test` |
| setup-env.sh prompt | none (shell script) | manual/live check | — | manual |
| Docs | none | build gate | — | `npm run build` |

Gates: quick=`npm run test:unit`, full=`npm run test`, build=`npm run build`.

## Execution Plan
```
Phase 1 (core + wiring):  T1 → T2 → T3
Phase 2 (consent + docs): T4 → T5
```

### T1: Install-id repository (SQLite) ✅
**What**: Extend `src/db/schema-sql.ts` with `CREATE TABLE IF NOT EXISTS telemetry (id TEXT PRIMARY KEY DEFAULT 'singleton', install_id TEXT NOT NULL)` (or simplest equivalent single-row table). `src/db/sqlite-telemetry-repository.ts`: `getOrCreateInstallId(db): string` -- reads existing row; if absent, generates `crypto.randomUUID()`, inserts, returns it. Unit tests (temp-file SQLite): first call creates + persists; second call (new connection, same file) returns the SAME id.
**Requirement**: TEL-02 · **Tests**: unit · **Gate**: quick
**Commit**: `feat(telemetry): persisted anonymous install id`

### T2: Telemetry client wrapper ✅
**What**: `npm i posthog-node`. `src/telemetry/telemetry-client.ts`: a `TelemetryPort` interface (`sendHeartbeat(props): Promise<void>`) + `PostHogTelemetryClient` (real, wraps `posthog-node`, `host: 'https://eu.i.posthog.com'`, calls `client.capture({distinctId, event:'notify_hub_heartbeat', properties:{...props, $process_person_profile:false}})` then `await client.shutdown()`) + `NoopTelemetryClient` (used whenever disabled/no key). `src/telemetry/resolve-telemetry-enabled.ts`: pure function `isTelemetryEnabled(env)` -- true only if `env.TELEMETRY_ENABLED` is truthy AND `env.DO_NOT_TRACK` is NOT set (any value disables). `src/telemetry/build-telemetry-client.ts`: `buildTelemetryClient(env)` -- returns `NoopTelemetryClient` if disabled or `POSTHOG_API_KEY` missing/empty, else the real one constructed with `env.POSTHOG_API_KEY` (baked-in default constant as the fallback value when the env var is entirely unset -- see spec's "API key distribution" row; Richard supplies the real key value separately, out of band, NEVER hardcode a real secret string in this task -- use an empty-string placeholder constant and load the real one from `POSTHOG_API_KEY` env only for now). `FakeTelemetryClient` in `test/helpers/fakes.ts` (records calls, like every other fake).
Unit tests: `isTelemetryEnabled` truth table (unset→false, enabled+no DNT→true, enabled+DNT→false, DNT alone without enabled→false since gate #1 already blocks); `buildTelemetryClient` returns Noop for every disable path (assert via a marker property or duck-typing, not real network); real client's payload-building function (extract `buildHeartbeatProperties({version, channelTypes, platform})` as a PURE function so the exact property shape is asserted without touching the SDK) -- empty channelTypes → `[]` not omitted.
**Requirement**: TEL-01 · **Tests**: unit · **Gate**: quick
**Commit**: `feat(telemetry): posthog client wrapper with opt-in gating`

### T3: Boot wiring ✅
**What**: In `src/bin/api.ts` and `src/bin/worker.ts` (or a shared boot helper both call), after the DB/repos are ready: `const channelTypes = [...new Set(channelRepo.listEnabled().map(c => c.type))]`; fire-and-forget `telemetryClient.sendHeartbeat({version: pkgVersion, channelTypesEnabled: channelTypes, platform: process.platform}).catch(() => {})` wrapped so ANY throw is swallowed and boot proceeds regardless (assert this in a test: inject a `FakeTelemetryClient` whose `sendHeartbeat` rejects, confirm the rest of boot/container wiring still completes). Read `package.json`'s version at build/runtime (existing pattern if any, else `JSON.parse(readFileSync(...))` from a known relative path -- keep it simple).
**Requirement**: TEL-03 · **Tests**: unit/integration (boot-never-blocks) · **Gate**: full
**Commit**: `feat(core): wire telemetry heartbeat into api and worker boot`

### T4: Setup-env.sh consent prompt + .env.example ✅
**What**: One new prompted block in `scripts/setup-env.sh` (mirroring its existing `ask`/`ask_secret` helper style): print the exact field list (version, channel types enabled, platform, anonymous install id -- no instance names, no credentials, no message content), then `ask "Enable anonymous usage telemetry? (y/N)"` defaulting to N/disabled; write `TELEMETRY_ENABLED=true`/`false` accordingly (never write `DO_NOT_TRACK` -- that's the user's own separate global env convention, not something this script sets). `.env.example`: add a `# --- Telemetry (opt-in, OFF by default) ---` block documenting `TELEMETRY_ENABLED`, `DO_NOT_TRACK`, `POSTHOG_API_KEY` (comment: "leave unset to use the project's own aggregate telemetry endpoint if you opt in; set your own PostHog key to redirect telemetry to a project you own instead"), with the exact same field list inline.
**Requirement**: TEL-04 · **Tests**: none (shell script) · **Gate**: build
**Commit**: `feat(scripts): telemetry consent prompt in guided setup`

### T5: TELEMETRY.md + README link ✅
**What**: New `TELEMETRY.md` at repo root: what's collected (the exact enumerated list, matching the code -- link the exact source file/line so it can never silently drift out of sync with reality), why (adoption visibility for an OSS maintainer), where (PostHog Cloud, EU region, link to PostHog's privacy policy), the write-only-key caveat (a leaked/public key can only write junk events, never read real data -- documented honestly per the research), both disable mechanisms. README: one short paragraph + link, explicitly stating "opt-in, disabled by default."
**Requirement**: TEL-05 · **Tests**: none · **Gate**: build
**Commit**: `docs: telemetry disclosure and README link`

## Validation
Verifier runs after T5 (author ≠ verifier): spec-anchored TEL-01..05 + discrimination sensor (esp. every disable path genuinely sends zero events, DO_NOT_TRACK override, boot-never-blocks-on-telemetry-failure, no identifying fields ever included); writes `.specs/features/telemetry/validation.md`. A REAL PostHog event delivery cannot be verified without Richard's actual project API key -- that step is a follow-up once he supplies it.
