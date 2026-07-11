# Decision Log

The decisions that shaped the system, condensed. The full ambiguity-interpretation
table (A1–A16) lives in [`specs/01-requirements.md`](../specs/01-requirements.md);
architecture details in [`specs/02-design.md`](../specs/02-design.md).

## How I read the ambiguous requirements

- **The dependency rule is a standing invariant, not just a transition check.** The
  brief says a task "cannot be moved to In Progress until its dependencies are
  Completed"; I hold the stronger form — *at all times, a task is in_progress only
  while every dependency is completed*. That forced three checkpoints: entering
  in_progress/completed is guarded; leaving Completed is refused while a dependent
  is actively in progress; dependencies are editable only while a task is Not
  Started — so "blocked but already working" is impossible by construction.
- **Recurrence**: "custom" = every N days/weeks/months — full iCal RRULE is
  disproportionate, and the date-math module is shaped so RRULE could swap in
  without schema changes. The next occurrence spawns only on completion (no
  background scheduler); an overdue completion skips missed periods to the first
  *future* anchor, keeping the weekday/day-of-month — never spawning
  already-overdue tasks, never flooding the list after an absence. Adding a
  first-time recurrence to an already-completed task spawns immediately: the
  user's intent is "make this recur", and the completion event already happened.
- **"Not permanently lost" protects the task's content; its dependency links are
  deliberately released.** The durability NFR is met with soft delete — everything
  the task owns survives and is restorable from a Trash view. Its dependency edges,
  though, are hard-removed in the same transaction: a link is a live constraint
  *between* tasks, not task content, and keeping it would let a later restore
  silently re-block other tasks or revive a dependency cycle. The severed links are
  recorded in the activity trail, so what's lost is only the constraint's effect —
  never the record that it existed.
- **Archived means shelved, not finished**: it never satisfies a dependency and is
  the only way to end a recurring series without completing it.
- **"Multiple users, same list" (NFR #1) is taken literally**: one shared list, no
  partitioning. Auth (built as stretch #1) supplies identity and attribution only —
  JWT in an httpOnly cookie, and every activity event records who did it.
- **Names are deliberately not unique**: identity is the UUID; recurrence
  legitimately produces same-name occurrences.
- **The detail panel is one atomic draft**: fields, dependency list, and status
  selection commit together in a single transaction or not at all; Cancel discards.
  A mixed instant/draft model proved confusing in use.

## Key architectural decisions

- **One guarded write path.** Every mutation flows through one service layer inside
  a transaction; no route can bypass the invariant checks. It also made the two
  features below nearly free.
- **Activity trail (self-added scope).** An append-only event log — create, edits
  with field-level diffs, status changes, dependency changes with severed links,
  delete/restore, recurrence spawns — written in the *same transaction* as the
  mutation it describes, so no change can skip logging and no event survives a
  rollback. Referenced names are snapshotted at event time (history stays honest
  through renames), and the trail outlives soft deletion. Audit logging is usually
  hard because of missed write sites; this architecture has exactly one. When auth
  shipped, threading the session user into the same choke point attributed every
  event in the system with one parameter.
- **Blocked is derived, never stored**: computed from live edges at query time. A
  stored flag invalidates as a *side effect* of other rows changing — a consistency
  trap under concurrent writers. Measured at 10k rows: worst-case blocked filter
  20 ms p95 vs 9 ms plain list — cheap insurance.
- **Concurrency is layered.** An optimistic `version` token on every write catches
  same-row conflicts and doubles as recurrence-spawn idempotency (a double-click
  cannot spawn twice). Cross-row invariant checks take targeted, id-ordered row
  locks: the read-only guards use FOR SHARE so parallel starts sharing a dependency
  never serialize; dependency *writes* use FOR UPDATE, making reverse-edge races
  structurally deadlock-free. The one remaining cross-guard deadlock is rare,
  detected by Postgres, and surfaced as a retryable 409 — accepted over paying for
  it on the hot path with wider locks.
- **10k+ NFR: computation lives where the data lives.** All filtering, sorting, and
  pagination run server-side over covering indexes; the calendar view is fed by a
  per-day window-function aggregation (~31 rows per month at any list size).
  Measured: default list 9 ms p95, filtered + sorted 3.8 ms at 10,000 rows.
- **Stack**: Fastify + Zod (one schema drives runtime validation, TS types, and the
  OpenAPI docs), Prisma/PostgreSQL, React + TanStack Query + headless Radix over a
  single design-tokens stylesheet. All list state lives in the URL.
- **Verification**: 125 unit/integration tests including deterministic concurrency
  tests (held-transaction interleavings, not fire-and-hope parallelism), plus one
  Playwright E2E that *is* the live-demo script.

## What I chose not to build

- **Real-time sync** — consistency under concurrent edits is already guaranteed by
  versioning; push channels would only add deploy and test surface.
- **Full RRULE**, **per-user lists**, **global name uniqueness**, **multi-column
  sort** — each examined; each cost more than the brief's scope justified.
- **A component-test suite** — the UI's risk concentrates in the live-demo flow,
  which the single E2E pins down end to end.
- **Auth hardening** — refresh-token rotation, password reset, login rate limiting.

## With more time

Cursor pagination (offset degrades past ~10k); the auth hardening above; per-user
timezone semantics (everything is UTC today); RRULE behind the existing recurrence
interface; bulk operations reusing the guarded write path; request metrics and
slow-query logging.
