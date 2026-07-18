# Local TTS Channel — Tasks

**Spec**: `.specs/features/local-tts-channel/spec.md`
**Status**: In Progress (Phase 1/3 done: player + adapter, 374 tests)
**Design (inline)**: Player = standalone Node.js host process (`clients/local-tts-player/`, zero/minimal deps, mirrors `clients/claude-code/notify-hook.mjs`'s "thin host client" pattern), loopback-only, using `child_process.execFile` (never shell string interpolation) for both listing voices and speaking. notify-hub gets a plain new channel type (`local-tts`) via the existing type-keyed registry — zero core changes beyond the adapter file + one registry line. Admin UI gets one hardcoded special case (not a generic framework) for the voice field.

## Test Coverage Matrix

| Layer | Test Type | Coverage Expectation | Location | Command |
| ----- | --------- | -------------------- | -------- | ------- |
| Player service (`/voices` parsing, `/speak` dispatch) | unit (mocked execFile — runs cross-platform, no real Mac/`say` needed) | voices-list parsing from sample `say -v '?'` output; speak invokes execFile with exact array args (injection-safety asserted); unknown voice falls back to default; loopback bind asserted | `clients/local-tts-player/*.test.mjs` | `npm --prefix clients/local-tts-player test` (or repo-root vitest include, worker's call) |
| notify-hub `local-tts` adapter | unit (FakeHttpClient) | exact request asserted; non-2xx/unreachable → throws | `src/channels/adapters/local-tts-channel.test.ts` | `npm run test:unit` |
| Admin voice-proxy route | e2e (inject, fake fetch to the player) | happy: returns voices list; player unreachable → graceful empty/error response, never 500-crashes the admin | `src/admin/routes/*.e2e.test.ts` | `npm run test` |
| Admin UI dropdown logic | unit (pure helper extracted, DOM-light) | renders select from voices; falls back to text input when fetch fails | `src/admin/ui/*.test.js` | `npm run test:unit` |
| launchd plist / docs | none | live smoke (real audio) | — | manual |

Gates: quick=`npm run test:unit`, full=`npm run test`, build=`npm run build`.

## Execution Plan
```
Phase 1 (player + adapter):  L1 → L2
Phase 2 (admin dropdown):    L3
Phase 3 (docs + live smoke): L4
```

### L1: Local TTS player service ✅
**What**: `clients/local-tts-player/local-tts-server.mjs` (zero-dep Node http server): `GET /voices` — `execFile('say', ['-v', '?'])`, parse each line `<name...>  <locale>    # <sample>` into `{name, locale, sample}` (name = everything before the locale code, trimmed — handles multi-word names like "Grandma (Portuguese (Brazil))"); `POST /speak` — body `{voice, text}`, `execFile('say', ['-v', voice || DEFAULT_VOICE, text])` (array args — text is NEVER concatenated into a shell string), respond 202 immediately (fire-and-forget, don't block the HTTP response on `say` finishing — a long announcement shouldn't hold the connection). Binds `127.0.0.1:<PORT env, default 8082>`. `clients/local-tts-player/local-tts-server.test.mjs`: parsing test against a captured real sample of `say -v '?'` output (multi-language, includes duplicate "Grandma" entries — assert each is a distinct, disambiguated entry); speak test with a fake/injected execFile seam asserting exact argv array (including a text containing `"; rm -rf /"` style content, asserting it lands as a single argv element, never shell-interpreted); unknown-voice fallback test; bind-address test.
**Requirement**: LTTS-01 · **Tests**: unit · **Gate**: quick
**Commit**: `feat(client): local tts player service` (c8f6db1)
**Note**: parser regex verified live against the full real `say -v '?'` output on this machine (180 voices, all parsed, 14 distinct Grandma entries); broadened the locale pattern to also accept UN M49 numeric region codes (e.g. Arabic `ar_001`, no single country) discovered during that live check — regression test added.

### L2: `local-tts` channel adapter ✅
**What**: `src/channels/adapters/local-tts-channel.ts` (`LocalTtsChannel implements NotificationChannel`, POSTs `{voice: cfg.LOCAL_TTS_VOICE, text: "${title}. ${message}"}` to `${cfg.LOCAL_TTS_URL}/speak` via injected `HttpClient`) + `localTtsRegistryEntry` (`requiredConfig: ['LOCAL_TTS_URL', 'LOCAL_TTS_VOICE']`, no maxLength). Register one line in `src/channels/channel-registry.ts`. `local-tts-channel.test.ts` mirrors the discord/slack adapter test style (exact request via FakeHttpClient, non-2xx throws).
**Requirement**: LTTS-02 · **Tests**: unit · **Gate**: quick
**Commit**: `feat(channels): local tts (macOS say) channel adapter` (deddc12)

### L3: Admin voice dropdown
**What**: `src/admin/routes/local-tts-voices-route.ts` — `GET /api/local-tts/voices?url=<player-url>` proxies to `<url>/voices` via the admin's `HttpClient`, returns the list or `{voices: [], reachable: false}` on failure (never 500s). Admin UI: in `admin-channels.js`, special-case `type === 'local-tts'`: render the `LOCAL_TTS_VOICE` field as `<select>` populated by fetching the proxy route (using the card's current `LOCAL_TTS_URL` value — re-fetch on blur/change of that field); on fetch failure, fall back to the normal masked text input. Extract the "build select options from a voices response" logic as a small pure/testable helper (`admin-local-tts.js` or similar).
**Requirement**: LTTS-03 · **Tests**: e2e (route) + unit (UI helper) · **Gate**: full
**Commit**: `feat(admin): local tts voice dropdown`

### L4: launchd + docs + live smoke
**What**: `clients/local-tts-player/com.notify-hub.local-tts-player.plist` (launchd, `RunAtLoad` + `KeepAlive`, logs to a file) + `clients/local-tts-player/install.md` (load with `launchctl load`, verify with `curl 127.0.0.1:8082/voices`). README: new channel row + short "Local TTS (your own speaker)" section explaining the Docker-can't-reach-host-audio constraint and why the player runs outside Docker. LIVE SMOKE (real audio, on this Mac): start the player, rebuild admin+worker to pick up the new channel type, add a `local-tts` instance in the panel with a real dropdown-picked voice (e.g. Luciana), Send test → confirm audible speech, then a real `POST /notify` end-to-end.
**Requirement**: LTTS-04 · **Tests**: none · **Gate**: build + full + live audio confirmed
**Commit**: `docs(client): local tts player launchd and setup`

## Validation
Verifier runs after L4 (author ≠ verifier): spec-anchored LTTS-01..04 + discrimination sensor (esp. execFile injection-safety, loopback bind, dropdown fallback-on-unreachable); writes `.specs/features/local-tts-channel/validation.md`. Live audio cannot be re-verified by a text-only Verifier — it inspects the reported live-smoke evidence (logs / HTTP traces) instead.
