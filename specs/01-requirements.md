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
| A13 | Can a completed task be reopened (or archived) while others have started work on top of it? | No. Any transition OUT of `completed` is rejected (409) while some dependent is `in_progress` — the user first completes/pauses that dependent, or moves it back to `not_started` and breaks the dependency (A11), then reopens. Dependents that are `completed` (history) or `not_started` (they simply become blocked again) do not prevent it | Closes the one remaining path that could create "in progress on top of an incomplete foundation" — making A11's impossible-by-construction guarantee actually hold. Pulling a foundation out from under active work should be an explicit, acknowledged act, not a silent side effect |
| A15 | What happens when a recurrence is ADDED to an already-completed TODO? | The next occurrence spawns immediately on save (first-time recurrence only; editing an existing recurrence never re-spawns). The panel warns before saving | The user's intent is "make this recur" — under pure event-driven semantics the recurrence would sit dormant until an unlikely reopen-and-recomplete, which reads as "I set it and nothing happened". The completion event has already occurred; honoring it late matches intuition |
| A16 | When do detail-panel edits take effect? | Everything in the panel — fields, dependency list, status selection — is one local draft, committed atomically by Save changes (a single transaction; all-or-nothing). Cancel or closing the panel discards it. List-row quick actions remain instant | A mixed model (some edits draft, some instant) proved confusing in use — there was no way to back out of a dependency change. One rule for the whole panel is learnable; atomicity means a rejected save (cycle, blocked, stale version) leaves NOTHING half-applied |
| A14 | Must TODO names be unique? | No — duplicates are allowed. Identity lives in the UUID; the name is a description, not a key | Uniqueness was considered and rejected: recurrence copies the name to each occurrence (R-2.2), so a completed "Weekly report" and its next not-started "Weekly report" legitimately coexist. Enforcing uniqueness would either break the spawn or force the system to rename the user's tasks (date/counter suffixes). Where duplicates could confuse — the dependency picker — results carry a status pill to disambiguate |
| A12 | "Archived" is named in the brief but never defined | Archived = shelved, not finished: it does not satisfy dependencies (A4); archiving keeps dependency edges, so dependents stay blocked — the UI marks the blocker as "(archived)" so the user can unarchive it or (the dependent being necessarily `not_started`) drop the dependency; archiving a recurring TODO ends the series without spawning; unarchive returns to `not_started` (A10) | Unlike delete (which severs edges, DL-5), an archived task still exists — the fact that others were waiting on it stays true and visible, and the user decides how to resolve it. Silent unblocking would let work start whose prerequisite never happened. Archive is also the only way to terminate a recurring series without completing it |
| A6 | "Multiple users … concurrently" with no auth requirement | Single shared list, no auth; conflicts handled via optimistic concurrency (version check → 409) | Auth is explicitly a nice-to-have; the NFR is about data integrity under concurrent writes, not identity |
| A7 | Do recurring occurrences inherit dependencies? | No — the new occurrence is created without dependency links | Dependencies usually describe a one-time ordering; auto-copying can create permanently-blocked chains. Logged as a revisit-with-more-time item |
| A8 | Cycles in dependencies | Rejected at write time (400 with the offending path) | A cycle makes every member permanently blocked; failing fast is the only sane behavior |
| A9 | "10,000+ items without degrading UX" | Server-side pagination/filtering/sorting with DB indexes; UI never loads the full list | Client-side filtering of 10k rows is the anti-pattern this NFR exists to catch |
| A10 | Legal status transitions unspecified | Explicit state machine incl. reopen (completed → in_progress/not_started) and unarchive (archived → not_started); every transition must also preserve the dependency invariant (R-3.0) | Mis-clicking "Complete" must be recoverable; nonsensical edges (archived → completed) rejected. Reopening a recurring TODO does not retract the already-spawned next occurrence |

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
  All other transitions are rejected with 400. Every transition must also preserve the
  dependency invariant (R-3.0) — R-3.4 checks it when entering `in_progress`/`completed`,
  R-1.9 when leaving `completed`; falling back to `not_started` can never violate it and
  is therefore always available. Reopening a completed recurring TODO SHALL NOT retract
  the occurrence its completion spawned (R-2.2).
- R-1.9 WHEN a transition OUT of `completed` (to any target) is requested and at least
  one dependent is `in_progress`, THE SYSTEM SHALL reject it with 409 listing the
  active dependents. Dependents that are `completed` or `not_started` do not prevent
  the transition — the latter simply become blocked again. (A13)

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
- R-2.7 WHEN a TODO that is already `completed` receives its FIRST recurrence (null →
  set), THE SYSTEM SHALL spawn the next occurrence immediately in the same save.
  Editing an existing recurrence never re-spawns — that completion already spawned
  its successor. (A15)

## R-3 Task Dependencies

As a user, I can declare that a TODO depends on other TODOs and be prevented from starting
it prematurely.

- R-3.0 **INVARIANT (the iron law).** At ALL times — not merely at transition time —
  a TODO may be `in_progress` only while EVERY dependency it has is `completed`.
  The brief states this as a transition rule ("cannot be moved to In Progress until…");
  we hold it as a standing invariant. Three checkpoints make every mutation preserve
  it: R-3.4 (entering in_progress/completed), R-1.9 (taking a dependency out of
  completed), and R-3.1/A11 (dependency edits only while not_started). Deletion
  preserves it structurally (R-1.4 severs the edges).

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
  (dueBefore/dueAfter), creation date range (createdBefore/createdAfter), dependency
  state (blocked | unblocked), and name substring (`q`, case-insensitive) — the latter
  also powers the dependency picker, which must search 10k+ items server-side. All
  range bounds are inclusive; the UI's date pickers expand a day to its full span.
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
- R-5.7 A calendar view (month grid) as an alternative to the list (DL-13): each day
  shows at most three tasks (incomplete before completed, then priority high → low)
  plus an overflow count, fed by a per-day aggregation endpoint so the payload stays
  ~31 rows at any list size (A9). Tasks open the detail panel; day numbers and
  overflow jump to the list filtered to that day. Past days with unfinished tasks
  wear the overdue red. Undated tasks don't appear.
- R-5.6 The detail panel is ONE draft (A16): fields, dependency list, and status
  selection persist only on Save changes, committed as a single atomic request;
  Cancel (or closing the panel) discards. Save/Cancel appear only when the draft
  differs from the server state. List-row quick actions stay instant.

## R-8 Authentication (stretch T-7.1 — built)

As a user, I register and log in, and my actions are attributed to me.

- R-8.1 Registration requires a unique email, a name, and a password of 8+ characters;
  passwords are stored as bcrypt hashes. Duplicate email → 409 EMAIL_TAKEN.
- R-8.2 Login issues a JWT session in an httpOnly, sameSite=lax cookie (7 days);
  logout clears it. Wrong password and unknown email return the SAME 401 — no
  account enumeration.
- R-8.3 The entire /api/todos surface requires a session — anonymous callers get 401
  BEFORE any validation runs. /api/health stays public.
- R-8.4 The list remains SHARED (NFR #1): auth attributes, never partitions. Every
  activity event records its actor (id + name snapshot, R-7.5), shown in the timeline
  and surviving later account renames.

## R-6 Non-Functional Requirements

- R-6.1 Concurrency: WHEN two clients update the same TODO concurrently, THE SYSTEM SHALL
  detect the conflict via a version field and return 409 to the stale writer. (A6)
- R-6.2 Durability: covered by R-1.4/R-1.5 (soft delete).
- R-6.3 Scale: with 10,000+ TODOs, list endpoints SHALL stay fast via indexes on
  (status, priority, due_date, deleted_at); verified by a seeded performance test.
- R-6.4 All API errors SHALL use a consistent envelope `{ error: { code, message, details } }`.

## R-7 Activity Trail (self-added scope, per the brief's "any other improvements")

As a user, I can open a TODO and see everything that ever happened to it, newest first.

- R-7.1 WHEN any mutation commits, THE SYSTEM SHALL append an activity record in the
  SAME transaction (the single guarded write path guarantees no mutation can skip it).
  Event types: `created`, `updated` (changed fields with old → new), `status_changed`,
  `dependencies_changed` (added/removed), `deleted` (including the severed links),
  `restored`, `spawned_next`, `created_from_recurrence`.
- R-7.2 Activity records are append-only and immutable; they are retained when the TODO
  is soft-deleted (they ARE the history).
- R-7.3 Payloads snapshot referenced names at event time — "dependency on 'Deploy
  staging' removed" stays readable even if that task is later renamed or deleted.
- R-7.4 GET /todos/:id/activities returns newest-first, paginated.
- R-7.5 Without auth, activities record WHAT happened, not who; when auth ships (M7),
  events gain actor attribution.

## Out of scope (deliberately not built)

- Real-time sync (WebSocket/SSE) — dropped: low benefit for a TODO list, and
  consistency under concurrent edits is already guaranteed by optimistic versioning
  (R-6.1); push would only add deployment and test surface.
- Multi-tenancy / per-user lists — the brief's baseline is one shared list (NFR #1).
- Task groups; full iCal RRULE recurrence.
- Time zones: all dates handled as UTC date-times; per-user timezone handling logged as future work.

Authentication (stretch #1) has since been BUILT — see R-8. Bulk operations remain a
stretch goal in `03-tasks.md` M7.
