# LESSONS — auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

### L-002 — Entrypoint-level fail-fast behavior (env validation, process.exit) must be extracted into a testable function or covered by a dedicated spawn test.
- signal: `spec_precision_gap` · recurrence: 2 feature(s) · scope: `entrypoints` · harmful: 0
- features: notification-gateway, mcp-server
- evidence: .specs/features/notification-gateway/validation.md (NOTIF-13.4 process.exit untested) (entrypoints) (+1 more)
- last seen: 2026-07-15T13:09:02Z

## Candidates (under observation — do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 — Queue reliability guarantees (retry, backoff, dead-letter) require an integration test that forces an exhausted-failure path; a happy-path smoke or single send never verifies them.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `queue` · harmful: 0
- features: notification-gateway
- evidence: .specs/features/notification-gateway/validation.md (NOTIF-02.2/02.3) (queue)
- last seen: 2026-07-15T06:10:41Z

### L-003 — Schema constraints (enums, bounds, formats) need a negative-case test asserting rejection, not just the constraint existing in code.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `schemas` · harmful: 0
- features: mcp-server
- evidence: .specs/features/mcp-server/validation.md (MCP priority enum no negative test) (schemas)
- last seen: 2026-07-15T13:09:02Z

### L-004 — Fallback/default-path tests must use fixtures where the expected outcome DIFFERS from the degenerate alternative (e.g. profile defaults must be a strict subset of enabled channels) — defaults==universe makes 'use defaults' and 'use everything' indistinguishable.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: db-channels
- evidence: .specs/features/db-channels/validation.md (mutation b, dispatch fallback) (tests)
- last seen: 2026-07-16T21:28:33Z

### L-005 — CLI entry guards comparing import.meta.url to argv[1] must use pathToFileURL (spaced paths break string concat) and be covered by a spawn test using a path containing a space.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `entrypoints` · harmful: 0
- features: hook-status
- evidence: .specs/features/hook-status/validation.md (isMain spaced-path bug, fixed 4a67476, no regression test) (entrypoints)
- last seen: 2026-07-17T05:38:31Z

## Quarantined (failed when applied — ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
