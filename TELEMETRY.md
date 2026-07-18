# Telemetry

notify-hub includes **optional, anonymous, usage telemetry**. It is **OFF by
default** on every install. This document is the full disclosure: exactly
what is collected, why, where it goes, and how to turn it off (or never turn
it on in the first place). Every claim below is a description of the actual
shipped code, cited by file path, so it can be audited rather than trusted.

## Default state

**OFF.** Telemetry only turns on if you make a deliberate, informed choice --
either by answering "y" to the prompt in `./scripts/setup-env.sh`, or by
hand-setting `TELEMETRY_ENABLED=true` in your `.env`. A fresh clone, an
`.env` copied from `.env.example`, or simply never touching the setting all
result in telemetry staying off.

## What is collected

If (and only if) you opt in, each `api` and `worker` process sends **one**
event, named `notify_hub_heartbeat`, **once per process boot** (see
"Frequency" below). The event carries exactly these fields and nothing
else:

| Field | What it is | Source |
| ----- | ---------- | ------ |
| `version` | notify-hub's own `package.json` version string | `src/telemetry/read-package-version.ts` |
| `channelTypesEnabled` | a de-duplicated array of the channel **types** you have enabled -- e.g. `["ntfy","slack"]` -- drawn from the closed set of adapter types this project ships (`ntfy`, `telegram`, `email`, `slack`, `discord`, `whatsapp`, `voicemonkey`, `local-tts`, `webhook`). **Never** instance names/labels/ids -- only which types are in use | computed in `src/container.ts` from `channelRepo.listEnabled()`, shaped by `src/telemetry/heartbeat-properties.ts` |
| `platform` | Node's own `process.platform` (e.g. `darwin`, `linux`) | `src/telemetry/heartbeat-properties.ts` |
| `distinctId` | a **randomly-generated anonymous install id** (`crypto.randomUUID()`), generated once and persisted in this instance's own local SQLite database (table `telemetry`), reused on every later boot. It is **not** derived from your hostname, IP address, MAC address, or any other identifying information | `src/db/sqlite-telemetry-repository.ts`, table defined in `src/db/schema-sql.ts` |

The exact wire payload (everything sent to PostHog beyond `distinctId`) is
built by one pure, unit-tested function --
`buildHeartbeatProperties()` in `src/telemetry/heartbeat-properties.ts` --
so there is a single place in the codebase where the entire set of
transmitted fields is defined and typed (`HeartbeatProperties` /
`PostHogHeartbeatPayload`). An empty `channelTypesEnabled` (fresh install,
no channels configured yet) is sent as `[]`, not omitted -- it proves
absence rather than hiding it.

**Frequency**: `api` and `worker` are separate processes that each build
their own instance of the container (`src/container.ts`) on startup, so each
independently sends its own heartbeat. Running the full stack therefore
sends 2 events per restart, not 1 -- a known, accepted minor overcount
(documented in the feature's own spec as not worth adding
cross-process deduplication for).

## What is NEVER collected

- No message content, ever (titles, bodies, tags -- nothing you send through
  `/notify`).
- No channel **instance** ids, labels, or per-instance config (only the
  closed-set channel *type*, e.g. `slack`, never `acme-slack` or
  `globex-slack`).
- No profile names, gateway tokens, channel credentials, or any other
  secret.
- No IP address is persisted anywhere.
- No hostnames.
- No cookies, no browser fingerprinting, no client-side tracking of any
  kind -- this is a server-side-only Node process; there is no telemetry in
  the admin panel's browser UI.

## Why

notify-hub is a public, self-hosted, open-source project (README, GitHub
topics, MCP registries). The maintainer has no visibility into adoption --
how many people actually run it, which channels get used -- and would like
some, without compromising the privacy commitments above. That is the
entire motivation; there is no product-analytics, funnel, or engagement
tracking beyond a single boot-time count.

## Where it goes

Events are sent to **PostHog Cloud, EU region**
(`https://eu.i.posthog.com`, see `POSTHOG_HOST` in
`src/telemetry/posthog-telemetry-client.ts`), into a PostHog project owned
by the maintainer. See PostHog's own privacy policy for how they handle
ingested data: <https://posthog.com/privacy>.

Every event is sent with PostHog's `$process_person_profile: false` flag
(also visible in `heartbeat-properties.ts`), which tells PostHog explicitly
**not** to build a persistent, tracked "Person" profile for your install --
each event lands as an anonymous analytics row, not an identity PostHog
accumulates history against.

## The write-only API key

`POSTHOG_API_KEY` (see `.env.example`) ships unset/empty in this repository
today -- no key is baked into the codebase or embedded as a default;
`src/telemetry/build-telemetry-client.ts` reads it from the environment
with no fallback value. Telemetry stays a no-op until the maintainer
supplies a real key out of band.

That real key, once added, will be a PostHog **Project API Key**, which is
a **write-only** key by PostHog's own documented security model: it can
submit new events to the project, but it cannot read the maintainer's
dashboard, existing events, or any other project data. This is the
property that will make it safe to embed that key value directly in this
public, open-source repository once it exists (the same posture PostHog
itself recommends for exactly this key type, and the same pattern used by
many other OSS projects' embedded analytics keys) -- there is no leak risk
even though the repository is public, because a write-only key grants no
read access to anyone who finds it.

**Accepted trade-off, disclosed honestly**: PostHog's ingestion endpoint
does not strictly validate that a submitted key "belongs" to the caller
beyond it being a valid write key for some project -- so a leaked or
guessed key could theoretically be used by anyone to submit junk/spam
events. The only consequence is noise in the maintainer's own PostHog
project (extra rows to filter out); it can **never** expose real data,
since the key has no read access. If you don't want to use the project's
key at all, set your own `POSTHOG_API_KEY` in `.env` to redirect telemetry
(if you opt in) to a PostHog project you control instead -- see
`src/telemetry/build-telemetry-client.ts`.

If `POSTHOG_API_KEY` is unset or empty, telemetry silently no-ops (logs
once, never throws, never blocks boot) even if `TELEMETRY_ENABLED=true` --
there is simply nowhere to send the event.

## How to disable

Two independent mechanisms, either one is sufficient:

1. **`TELEMETRY_ENABLED=false`** in `.env` -- or simply never set it to
   `true` (the default). See the gate logic in
   `src/telemetry/resolve-telemetry-enabled.ts`: only the strings `true` or
   `1` (case-insensitive) count as "enabled".
2. **`DO_NOT_TRACK=1`** (or any non-empty value) in your environment -- a
   **hard override** respected regardless of `TELEMETRY_ENABLED`, honoring
   the informal cross-tool convention used by Homebrew, Next.js, and
   others. This is checked first in
   `src/telemetry/resolve-telemetry-enabled.ts` and short-circuits
   everything else.

If telemetry ever fails for any reason (network error, PostHog outage,
malformed response), it is caught and logged in
`src/telemetry/posthog-telemetry-client.ts` and never re-thrown -- a
telemetry failure can never delay or crash `api`/`worker` boot.

## Opting in

`./scripts/setup-env.sh` asks a single y/N question (default: disabled --
just press Enter to skip) after showing this same field list, and writes
`TELEMETRY_ENABLED=true`/`false` accordingly. You can also opt in later by
hand-editing `.env` and setting `TELEMETRY_ENABLED=true`.
