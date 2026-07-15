# Admin Panel Tasks

**Spec**: `.specs/features/admin-panel/spec.md`
**Status**: Implementation complete (pending validation)
**Scope**: Large-ish — 2 phases, 5 tasks. Design inline: host-side Fastify app (`src/admin/`), Ports & Adapters like the rest of the repo — new ports `FileStore` (read/write/backup .env) and `CommandRunner` (compose/logs), gateway reached via existing `HttpClient` port. UI = vanilla dark dashboard served as static files.

## Test Coverage Matrix (inherits project conventions)

| Code Layer | Test Type | Coverage Expectation | Location | Run Command |
| ---------- | --------- | -------------------- | -------- | ----------- |
| env-file store (parse/serialize/backup) | unit | Round-trip; unknown-key preservation; atomic write + backup; missing file | `src/admin/*.test.ts` | `npm run test:unit` |
| Config validation (channels + profiles) | unit | Enabled-channel-missing-key rejected naming channel+key; profile default channel not enabled rejected; happy | `src/admin/*.test.ts` | `npm run test:unit` |
| Admin API routes | e2e (inject) | GET config; save happy + both validation failures (nothing written); apply ok/fail; status up/down; test-send ok/fail/gateway-down; 127.0.0.1 binding asserted | `src/admin/**/*.e2e.test.ts` | `npm run test` |
| UI static assets / bin entrypoint | none | Build gate + live smoke | — | `npm run build` |

Gates unchanged: quick=`npm run test:unit`, full=`npm run test`, build=`npm run build`.

## Execution Plan

```
Phase 1 (backend):  A1 → A2 → A3
Phase 2 (UI+wire):  A4 → A5
```

### A1: env-file store + config model ✅
**What**: `src/admin/env-file-store.ts` — `FileStore` port + Node fs impl; parse `.env` → `AdminConfig` {channels: enabled+values per registry entry, profiles from TOKENS, extraKeys passthrough}; serialize back canonically; atomic write (tmp+rename) with timestamped `.backup.*`; missing file → empty model. Reuses `channelRegistry` for the per-channel key schema.
**Requirement**: ADMIN-02, ADMIN-03 · **Tests**: unit · **Gate**: quick
**Commit**: `feat(admin): env file store with round-trip and backups`

### A2: admin server + config routes ✅
**What**: `src/admin/admin-server.ts` — `buildAdminServer(deps)` (Fastify, serves static UI dir + JSON API); `GET /api/config`; `PUT /api/config` validating: enabled channel missing required key → 400 naming channel+key, profile defaultChannel not enabled → 400 naming it; on valid → backup + write via FileStore (no write on validation failure). Binding: listen host hardcoded `127.0.0.1` (test asserts). e2e via inject with in-memory FileStore fake.
**Requirement**: ADMIN-01, ADMIN-02, ADMIN-03 · **Tests**: e2e · **Gate**: full
**Commit**: `feat(admin): config API with fail-fast validation`

### A3: apply, status and test-send routes ✅
**What**: `CommandRunner` port (`run(cmd, args) → {code, stdout, stderr}`) + real impl (execFile); `POST /api/apply` → `docker compose up -d` outcome; `GET /api/status` → gateway `/health` + `/channels` (HttpClient, first profile token) + last worker delivery lines (`docker compose logs worker --since 10m` parsed for channel sent/failed); `POST /api/test-send {channel}` → POST `/notify` (channels:[channel]) then poll logs (~10s) for that channel's newest result → `{ok, detail}`; gateway unreachable → clear error, no hang. All fakes-injected tests.
**Requirement**: ADMIN-04, ADMIN-05, ADMIN-06 · **Tests**: e2e/unit · **Gate**: full
**Commit**: `feat(admin): apply, status and per-channel test-send`

### A4: dark dashboard UI ✅
**What**: `src/admin/ui/admin.html` + `admin.css` + `admin.js` (vanilla, self-contained, no CDN; each file <200 lines, split further if needed). Dark dev-dashboard: status bar (gateway/redis/active channels), channel cards (enabled toggle, per-key inputs `type=password` + eye reveal toggle + copy, Send test button with inline ✅/❌ + reason), profiles section (name, token masked+reveal, default-channel chips), sticky Save & Apply bar appearing on unsaved changes, apply-steps feedback (validate → backup → write → compose), error toasts. Fetches the A2/A3 API.
**Requirement**: ADMIN-07 (+ AC coverage of reveal/masking, unsaved tracking) · **Tests**: none (behavior covered via API tests; UI smoke in A5) · **Gate**: build
**Commit**: `feat(admin): dark dashboard UI`

### A5: entrypoint, script, docs + live smoke ✅
**What**: `src/bin/admin.ts` (loads paths, builds server, prints URL; stderr-only logs), `package.json` script `"admin": "tsx src/bin/admin.ts"`, `.env.example` note `ADMIN_PORT=8081`, README "Admin panel" section (screenshot placeholder ok). Live smoke: start admin, `curl 127.0.0.1:8081/api/config` + `/api/status` against the real running stack, load UI HTML (200), then stop.
**Requirement**: ADMIN-01 (+docs) · **Tests**: none · **Gate**: build + full-suite sanity
**Commit**: `feat(admin): entrypoint, npm script and docs`

## Validation

Verifier runs automatically after A5 (author ≠ verifier): spec-anchored coverage ADMIN-01..07 + discrimination sensor; writes `.specs/features/admin-panel/validation.md`.
