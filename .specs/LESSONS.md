# LESSONS — auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation — do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 — Queue reliability guarantees (retry, backoff, dead-letter) require an integration test that forces an exhausted-failure path; a happy-path smoke or single send never verifies them.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `queue` · harmful: 0
- features: notification-gateway
- evidence: .specs/features/notification-gateway/validation.md (NOTIF-02.2/02.3) (queue)
- last seen: 2026-07-15T06:10:41Z

## Quarantined (failed when applied — ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
