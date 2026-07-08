# 01 — Requirements Specification

Project: SleekFlow TODO List Web Application
Format: User stories with EARS-style acceptance criteria (WHEN/WHILE … THE SYSTEM SHALL …).
Each requirement has an ID (R-x.y) so design decisions, tasks, and tests can trace back to it.

## Interpretation of ambiguous requirements

These interpretations are decisions, not assumptions — each is recorded with reasoning and will
be restated in the decision log.

| # | Ambiguity in brief | Interpretation | Reasoning |
|---|--------------------|----------------|-----------|
| A1 | "Custom" recurrence schedule | Interval-based: every N days / weeks / months | Full RRULE (iCal) is disproportionate for this scope; interval covers the daily/weekly/monthly cases as degenerate forms (N=1) plus "every 3 days" style customs |
| A2 | Next occurrence's due date | Computed from the *previous due date*, not completion date; an overdue completion skips missed periods to the first future anchor | Keeps cadence stable (a weekly report due Friday stays on Fridays even if completed Wednesday); never spawns an already-overdue occurrence, and doesn't flood the list with missed periods |
| A3 | Dependency rule only mentions "In Progress" | Blocked tasks can be moved to neither "In Progress" **nor** "Completed" | Allowing direct completion would make the In-Progress gate meaningless (loophole) |
| A4 | Does an Archived dependency count as satisfied? | No. Only status = Completed satisfies a dependency | Archiving is putting away, not finishing |
| A5 | "Data should not be permanently lost when deleted" | Soft delete (`deleted_at` timestamp) + restore endpoint. Deleting a TODO also permanently removes its dependency links (both directions, same transaction); restore brings the task back without them | The task's own data survives; severing links keeps other tasks' blocked state from being silently changed by a later restore, and makes cycle revival through restore structurally impossible |
| A11 | Who can edit dependencies, when | Dependencies are editable only while the dependent task is `not_started`; to change dependencies of a started task, move it back to `not_started` first | Keeps "blocked but in progress" states structurally impossible instead of legislating their semantics; dependency graphs are decided before work starts |
| A12 | "Archived" is named in the brief but never defined | Archived = shelved, not finished: it does not satisfy dependencies (A4); archiving keeps dependency edges, so dependents stay blocked — the UI marks the blocker as "(archived)" so the user can unarchive it or (the dependent being necessarily `not_started`) drop the dependency; archiving a recurring TODO ends the series without spawning; unarchive returns to `not_started` (A10) | Unlike delete (which severs edges, DL-5), an archived task still exists — the fact that others were waiting on it stays true and visible, and the user decides how to resolve it. Silent unblocking would let work start whose prerequisite never happened. Archive is also the only way to terminate a recurring series without completing it |
| A6 | "Multiple users … concurrently" with no auth requirement | Single shared list, no auth; conflicts handled via optimistic concurrency (version check → 409) | Auth is explicitly a nice-to-have; the NFR is about data integrity under concurrent writes, not identity |
| A7 | Do recurring occurrences inherit dependencies? | No — the new occurrence is created without dependency links | Dependencies usually describe a one-time ordering; auto-copying can create permanently-blocked chains. Logged as a revisit-with-more-time item |
| A8 | Cycles in dependencies | Rejected at write time (400 with the offending path) | A cycle makes every member permanently blocked; failing fast is the only sane behavior |
| A9 | "10,000+ items without degrading UX" | Server-side pagination/filtering/sorting with DB indexes; UI never loads the full list | Client-side filtering of 10k rows is the anti-pattern this NFR exists to catch |
| A10 | Legal status transitions unspecified | Explicit state machine incl. reopen and unarchive; the blocked guard applies ONLY to edges into `in_progress` and `completed` — edges to `not_started`/`archived` are always free | Mis-clicking "Complete" must be recoverable; nonsensical edges (archived → completed) rejected. Guarding backward edges would trap tasks in `completed` when a dependency gets reopened. Reopening a recurring TODO does not retract the already-spawned next occurrence |

## R-1 TODO Management (CRUD)

As a user, I can create, view, update, and delete TODOs.

- R-1.1 WHEN a TODO is created with a name, THE SYSTEM SHALL persist it with a unique ID,
  name, optional description, optional due date, status (default: Not Started), and
  priority (default: Medium).
- R-1.2 WHEN a create/update request has invalid input (empty name, name > 255 chars,
  unknown status/priority, malformed date), THE SYSTEM SHALL reject it with 400 and a
  machine-readable error body; nothing is persisted.
- R-1.3 WHEN a TODO is updated, THE SYSTEM SHALL apply partial updates (PATCH semantics)
  and bump its version/updated-at.
- R-1.4 WHEN a TODO is deleted, THE SYSTEM SHALL soft-delete it (set `deleted_at`) AND,
  in the same transaction, permanently remove all dependency links it participates in
  (as dependent and as dependency). It disappears from all default listings but the task
  row remains in the database. (A5)
- R-1.5 WHEN a restore is requested on a soft-deleted TODO, THE SYSTEM SHALL clear
  `deleted_at` and return the TODO to its previous status, WITHOUT its former dependency
  links — restore never changes other tasks' blocked state and can never revive a
  dependency cycle. (A5)
- R-1.6 WHEN any operation targets a non-existent or deleted TODO (except restore),
  THE SYSTEM SHALL return 404.
- R-1.7 Status values: `not_started`, `in_progress`, `completed`, `archived`.
  Priority values: `low`, `medium`, `high`.
- R-1.8 Legal status transitions (A10): `not_started ↔ in_progress`;
  `not_started | in_progress → completed`; `completed → in_progress | not_started`
  (reopen); any non-archived → `archived`; `archived → not_started` (unarchive).
  All other transitions are rejected with 400. The blocked guard (R-3.4) applies only
  to edges INTO `in_progress` or `completed`; edges to `not_started` or `archived` are
  never guarded. Reopening a completed recurring TODO SHALL NOT retract the occurrence
  its completion spawned (R-2.2).

## R-2 Recurring Tasks

As a user, I can make a TODO recur so a fresh occurrence is created when I complete it.

- R-2.1 WHEN a TODO is created or updated, THE SYSTEM SHALL accept an optional recurrence
  of the form `{ frequency: daily | weekly | monthly, interval: N ≥ 1 }`. (A1)
- R-2.2 WHEN a recurring TODO transitions to Completed, THE SYSTEM SHALL atomically create
  the next occurrence: same name, description, priority, and recurrence; status
  Not Started; due date = the first `previous due date + k × interval` (k ≥ 1) that is
  in the future. On-time completions get k = 1; overdue completions skip missed periods
  while keeping the cadence anchor (day-of-week / day-of-month). (A2)
- R-2.2a A recurring TODO that is never completed SHALL NOT spawn occurrences on its own —
  it stays as a single overdue item (no background scheduler; matches mainstream TODO
  products and the brief's completion-triggered wording).
- R-2.3 WHILE a recurring TODO has no due date, THE SYSTEM SHALL spawn the next
  occurrence also without a due date — an undated series never silently converts into a
  dated one anchored on an arbitrary completion timestamp.
- R-2.4 WHEN the same completion request is retried (idempotency / double-click), THE
  SYSTEM SHALL NOT create duplicate occurrences.
- R-2.5 Monthly edge case: WHEN the previous due date's day-of-month does not exist in the
  target month (e.g. Jan 31 + 1 month), THE SYSTEM SHALL clamp to the last day of the
  target month.
- R-2.6 The new occurrence SHALL NOT inherit dependency links. (A7)

## R-3 Task Dependencies

As a user, I can declare that a TODO depends on other TODOs and be prevented from starting
it prematurely.

- R-3.1 WHEN dependencies are set on a TODO, THE SYSTEM SHALL accept a list of other TODO
  IDs; self-dependency is rejected with 400. Dependencies are editable ONLY while the
  dependent TODO is `not_started` — otherwise 409 with an error directing the user to
  move the task back to Not Started first. (A11)
- R-3.2 WHEN adding a dependency would create a cycle (direct or transitive), THE SYSTEM
  SHALL reject with 400 and include the cycle path in the error. (A8)
- R-3.3 A TODO is **blocked** iff at least one of its (non-deleted) dependencies has
  status ≠ Completed. (A4)
- R-3.4 WHEN a status change to In Progress or Completed is requested on a blocked TODO,
  THE SYSTEM SHALL reject with 409 and list the incomplete dependency IDs. (A3)
- R-3.5 WHEN a TODO is soft-deleted, its dependency links are removed with it (R-1.4),
  so it can never block another task — structurally, not via query-time filtering.

## R-4 Filtering, Sorting, Pagination

As a user, I can find TODOs in a large list.

- R-4.1 THE SYSTEM SHALL filter by: status (multi), priority (multi), due date range
  (dueBefore/dueAfter), dependency state (blocked | unblocked), and name substring
  (`q`, case-insensitive) — the latter also powers the dependency picker, which must
  search 10k+ items server-side.
- R-4.2 THE SYSTEM SHALL sort by: due date, priority, status, name — ascending or
  descending, with a stable tiebreaker (id).
- R-4.3 THE SYSTEM SHALL paginate all list responses (default 20, max 100 per page) and
  return the total count.
- R-4.4 Filters, sort, and pagination SHALL be executed in the database, not in
  application memory. (A9)

## R-5 Web UI

As a user, I can do all of the above from a browser.

- R-5.1 List view with visible status, priority, due date, blocked indicator; controls
  for filter, sort, and pagination.
- R-5.2 Create/edit form with validation feedback, including recurrence and dependency
  pickers.
- R-5.3 Status transitions (start / complete / archive), delete, and restore from the list.
- R-5.4 WHEN the API rejects an action (blocked task, version conflict, validation), THE
  UI SHALL surface the reason to the user instead of failing silently.
- R-5.5 Polish is explicitly out of scope; functional and usable is the bar.

## R-6 Non-Functional Requirements

- R-6.1 Concurrency: WHEN two clients update the same TODO concurrently, THE SYSTEM SHALL
  detect the conflict via a version field and return 409 to the stale writer. (A6)
- R-6.2 Durability: covered by R-1.4/R-1.5 (soft delete).
- R-6.3 Scale: with 10,000+ TODOs, list endpoints SHALL stay fast via indexes on
  (status, priority, due_date, deleted_at); verified by a seeded performance test.
- R-6.4 All API errors SHALL use a consistent envelope `{ error: { code, message, details } }`.

## Out of scope (deliberately not built)

- Real-time sync (WebSocket/SSE) — dropped: low benefit for a TODO list, and
  consistency under concurrent edits is already guaranteed by optimistic versioning
  (R-6.1); push would only add deployment and test surface.
- Multi-tenancy / per-user lists — the brief's baseline is one shared list (NFR #1).
- Task groups; full iCal RRULE recurrence.
- Time zones: all dates handled as UTC date-times; per-user timezone handling logged as future work.

Authentication and bulk operations are NOT out of scope — they are stretch goals,
planned in priority order in `03-tasks.md` M7 (auth first).
