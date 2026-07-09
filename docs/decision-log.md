# Decision Log

> Working draft — entries are appended as decisions are made during spec review and
> implementation, then edited down to 1–2 pages before submission.
> Requirement interpretations (A1–A9) live in `specs/01-requirements.md`; architecture
> decisions (D1–D6) in `specs/02-design.md`. This log records the reasoning highlights
> and anything decided after the specs were first written.

## DL-1 — Dependency guard is protected against write races (2026-07-08)

**Context.** A task with incomplete dependencies must not move to In Progress/Completed
(R-3.4). The naive implementation — read dependency statuses, check, then write — has a
race: while task B's transition is being checked, a concurrent request can reopen B's
dependency A. Both commit under Postgres's default READ COMMITTED isolation, leaving B
"In Progress" with an incomplete dependency.

**Decision.** The transition transaction locks the dependency rows with
`SELECT … FOR SHARE` before the guard check.

**Alternatives considered.**
- *SERIALIZABLE isolation*: same guarantee, but requires retry-on-serialization-failure
  plumbing; heavier than needed.
- *Accept and document*: collision odds are low at this scale, but the fix is one raw SQL
  line inside an existing transaction — cheap enough that accepting the bug wasn't
  justified.

**Trade-off.** FOR SHARE (not FOR UPDATE) so concurrent readers and other transitions
sharing the same dependency don't serialize; writers to the locked rows wait until the
transition commits. Cost: one `$queryRaw` escape hatch in otherwise-Prisma code.

## DL-2 — Overdue recurring tasks: no auto-spawn; late completion skips missed periods (2026-07-08)

**Context.** The brief only says the next occurrence is created "when a recurring TODO is
marked as completed". Two gaps: (1) what if it's never completed? (2) when completed
late, where does the next due date land?

**Decision.**
1. No background scheduler — an incomplete recurring task stays as a single overdue item
   and never spawns on its own. This matches the brief's completion-triggered wording and
   mainstream TODO products (one overdue "water the plants", not fourteen).
2. Late completion computes `next = previous due + k × interval` for the smallest k ≥ 1
   that lands in the future. On-time completions behave identically to the naive rule
   (k = 1); overdue completions skip missed periods while keeping the cadence anchor
   (a Friday report stays on Fridays).

**Alternatives considered.**
- *Strict roll-forward (always k = 1)*: spawns an already-overdue occurrence after a late
  completion, forcing the user to complete-complete-complete to catch up.
- *Materialize all missed periods*: calendar semantics, but floods a TODO list after any
  absence.
- *Calendar-style scheduler that spawns at due-date rollover regardless of completion*:
  requires a background component to deploy and reason about; rejected for scope.

**User impact.** Coming back from a two-week holiday shows one overdue item per recurring
task, and completing it schedules the next one on the original weekday/day-of-month.

**Amendment.** A recurring task without a due date spawns occurrences that also have no
due date — an undated series never silently converts into a dated one anchored on an
arbitrary completion timestamp.

## DL-3 — Explicit status state machine with reopen support (2026-07-08)

**Context.** The brief lists four statuses but never says which transitions are legal.
Undefined transition rules would surface as inconsistent behavior (can an archived task
be completed? can a mis-clicked "Complete" be undone?).

**Decision.** An explicit transition table in `domain/transitions.ts` (see diagram in
`specs/02-design.md` D2): `not_started ↔ in_progress → completed`, reopen
(`completed → in_progress/not_started`, re-running the blocked guard), archive from any
non-archived status, unarchive to `not_started`. Everything else → 400.

**Key edge decided.** Reopening a completed recurring TODO does not retract the next
occurrence its completion spawned — that row may already have been edited by another
user; silently deleting data is worse than one extra visible row the user can delete.

**Alternatives considered.**
- *Forward-only (no reopen)*: least code, but a mis-click on "Complete" becomes
  permanent — unacceptable UX for a multi-user list.
- *No rule table (only the blocked guard)*: allows nonsensical edges like
  archived → completed; every such edge becomes an untestable behavior question.

**User impact.** A mis-clicked "Complete" is one click to undo; archived tasks must be
consciously unarchived before they re-enter the workflow.

**Amendment — archived semantics (A12).** Archived means shelved, not finished: it never
satisfies a dependency, so dependents stay blocked (the UI marks the blocker as
archived; the user unarchives it or drops the dependency). Unlike delete, archiving
keeps dependency edges — the task still exists, so the fact others were waiting on it
stays true and visible. Archiving is also the only way to end a recurring series
without completing it.

## DL-4 — Frontend testing: one E2E of the demo path, no component-test suite (2026-07-08)

**Decision.** The backend carries exhaustive unit + integration coverage; the frontend
gets exactly one Playwright E2E that walks the interview demo script (create → blocked
by dependency → unblock → complete → recurring spawn visible).

**Reasoning.** The UI is explicitly "functional, not polished" in the brief; its risk
concentrates in one flow — the one demoed live. A component-test suite (form validation,
filter bar) would cost more than the whole E2E and mostly re-test what the backend
integration tests and Zod schemas already pin down. The E2E also runs against the real
docker-compose stack, so it doubles as a pre-demo smoke check.

**Not built.** React Testing Library component tests — revisit if the UI grows real
client-side logic (optimistic updates, offline queue).

## DL-5 — Dependency graph stays clean by construction (2026-07-08)

**Context.** Three underspecified corners of the dependency feature: can dependencies be
edited on a started/completed task? What happens to dependency links when a task is
deleted and later restored? Does the blocked guard apply to backward transitions?

**Decisions.**
1. *Dependencies are editable only while the task is Not Started.* To change a started
   task's dependencies, move it back to Not Started first. This makes contradictory
   states ("in progress but blocked") impossible by construction instead of legislating
   their semantics, and simplifies the UI (picker only on not-started tasks). The
   alternative — allowing edits in any status and declaring that blocked only gates
   transitions — was considered and rejected as needless surface area.
2. *Deleting a task severs its dependency links (both directions) in the same
   transaction; restore brings the task back without them.* Restore therefore never
   changes other tasks' blocked state and can never revive a dependency cycle — the
   graph only ever contains live tasks, so cycle detection needs no deleted-node rules.
   Trade-off (documented): an accidental delete permanently loses the link structure;
   the task's own data survives, satisfying the durability NFR.
3. *The blocked guard applies only to edges into In Progress / Completed.* Backward
   edges (→ Not Started, → Archived) are always free — guarding them would trap a
   completed task forever once one of its dependencies gets reopened.

**Why it matters.** These three rules compose: the only entry point to dependency
editing (Not Started) is exactly the state every backward edge can always reach, so no
task can ever be wedged.

## DL-6 — Is this really a multi-user system? (2026-07-08)

**Context.** During review we challenged our own premise: would two users ever really
race on one TODO list? The brief's first NFR answers it: "The API should support
multiple users accessing the same TODO list concurrently" — the *same* list, and auth
is explicitly a nice-to-have, so the baseline is an unauthenticated shared list.

**Assessment.** Concurrency exists even single-user (double-clicks, two browser tabs,
client retries), which is what the idempotent-completion and optimistic-version
mechanisms cover; the rarer two-writer races (dependency guard, DL-1) are covered
because the NFR names them and the cost was one locking pattern reused twice.

## DL-7 — Scope guardrails: demo interpretation and cut order (2026-07-08)

**Live demo = local.** The brief says to have "the application running locally before
the interview", so no hosting/deployment work is planned — docker-compose is the whole
runtime story.

**Stretch priority** (if core lands early): auth first (registration/login with actions
attributed to users; the list stays shared per the NFR), then bulk operations, then
cursor pagination. Real-time sync (SSE/WebSocket) is dropped entirely — low benefit for
a TODO list, and consistency under concurrent edits is already guaranteed by the
optimistic version check, so push would only add deploy and test surface.

**Cut order under time pressure** (first to go → last; everything below the line is
never cut):
1. M7 stretch items (auth, bulk operations, cursor pagination)
1.5. Activity trail (M3.5 + panel timeline — self-added scope, cleanly severable)
2. T-4.5 perf test (the 10k seed script stays — it's needed for manual verification)
3. T-6.4 app Dockerfiles (Postgres compose service stays)
4. T-5.6 Playwright E2E (falls back to a written manual demo checklist)
5. UI conveniences: URL-synced filter state, restore-from-deleted view
---
Never cut: CRUD + soft delete/restore, dependencies with guard + locks, recurrence with
idempotent spawn, list filters/sort/pagination at 10k, the simple UI over all of it,
tests for the above, README, OpenAPI docs, this decision log.

## DL-8 — Activity trail: self-added scope the architecture made cheap (2026-07-08)

**Context.** Once a dependency is removed or a task deleted, the system had no memory —
DL-5 explicitly recorded "an accidental delete permanently loses the link structure" as
an accepted trade-off. The brief invites "any other improvements you see fit".

**Decision.** An append-only `Activity` table: every mutation (create, field edits,
status changes, dependency add/remove, delete with the severed links, restore,
recurrence spawn) appends an event **in the same transaction**, via the single guarded
write path (DL-1/D2) that every mutation already flows through — so no mutation can
skip logging and no event can outlive a rolled-back change. Names are snapshotted in
payloads so history stays readable after renames/deletes. Surfaced as a read-only
timeline in the todo's detail panel.

**Why the cost is low.** Audit logging is usually hard because of missed write sites;
this architecture has exactly one write site. One table, one line per mutation, one GET
endpoint, one read-only UI section.

**Scope discipline.** Positioned second in the cut order (right after M7 stretch) —
cleanly severable if time runs short. Without auth it records what happened, not who;
actor attribution arrives automatically if M7 auth ships.

## DL-9 — Leaving Completed is guarded against in-progress dependents (2026-07-09)

**Context.** DL-5 claimed "blocked but in progress" was impossible by construction, but
one path still produced it: task B starts on top of completed dependency A, then A gets
reopened (backward edges were unconditionally free). Spotted while reviewing seeded
data in the UI.

**Decision.** Any transition OUT of Completed — reopen to In Progress/Not Started, or
Archive — is rejected (409, listing the active dependents) while some dependent is
In Progress. The user resolves it explicitly: finish the dependent, pause it back to
Not Started (always free, A10), or break the dependency (A11) — then reopen.
Dependents that are Completed don't block (their work is history and can't be
retroactively undone); Not Started dependents don't block (they simply become blocked
again, which is exactly right).

**Why.** Pulling a foundation out from under active work should be an acknowledged
act, not a silent side effect. This supersedes the unconditional "backward edges are
always free" wording in DL-5 — backward edges remain free with respect to the task's
OWN dependencies; they now respect its dependents. With this, A11's
impossible-by-construction guarantee actually holds everywhere.

**Concurrency.** The guard locks dependent rows FOR SHARE; the opposite-order lock
crossfire with a simultaneously-starting dependent is resolved by Postgres deadlock
detection, surfaced as a retryable 409.

**Reframed (same day).** The cleaner statement of all of this is a single standing
invariant, now recorded as R-3.0: *a task is in_progress only while all its
dependencies are completed — at all times, not merely at transition time*. The brief
phrases the rule transitionally; holding it as an invariant is what forced closing the
reopen hole. R-3.4, R-1.9, and A11 are just the three checkpoints that preserve it.
The earlier "backward edges are always free" wording is retired: its trap-avoidance
rationale only ever justified the → not_started edge, which the invariant can indeed
never object to.
## DL-10 — TODO names are deliberately not unique (2026-07-09)

**Context.** Considered adding a uniqueness constraint on names — two identical
"Write report" tasks look like a data-quality bug waiting to happen.

**Decision.** Duplicates stay allowed. Identity is the UUID; the name is a
description, not a key.

**The deciding argument: recurrence.** R-2.2 copies the name to each spawned
occurrence, so at the moment of completion a completed "Weekly report" and its
next not-started "Weekly report" coexist by design. The workable variants were
examined and rejected:
- *Global uniqueness* breaks the spawn outright, or forces the system to rename the
  user's tasks with date/counter suffixes — software should not name things on the
  user's behalf.
- *Uniqueness scoped to active tasks only* (not_started/in_progress) is internally
  consistent, but adds a partial unique index plus checks on every path into the
  active states (create, rename, reopen, unarchive, restore) — real complexity for a
  rule the brief never asked for, and mainstream TODO products don't enforce.

**Mitigation for the one real friction point.** The dependency picker could show two
indistinguishable same-name results; its rows carry a status pill to disambiguate,
and adding a due-date subtitle is a one-line follow-up if it ever bites.

## DL-11 — Adding a recurrence to a completed task spawns immediately (2026-07-09)

**Context.** Under pure event-driven semantics (spawn fires on the transition to
Completed), a recurrence added AFTER completion sat dormant until an unlikely
reopen-and-recomplete. To the user this read as "I set it and nothing happened".

**Decision.** A first-time recurrence (null → set) saved onto an already-completed
task spawns the next occurrence right away, in the same transaction. The user's
intent — "make this recur" — outweighs the purity of the event model; the completion
event has already happened, we honor it late. Editing an EXISTING recurrence never
re-spawns (that completion already produced its successor — re-spawning on every
interval tweak would duplicate). The panel warns before such a save: "this task is
already completed — saving will immediately create the next occurrence."

## DL-12 — The detail panel is one atomic draft (2026-07-09)

**Context.** The panel originally mixed two interaction models: fields were
draft-and-Save, while dependency edits and status changes applied instantly. Undo
toasts were added to soften the instant side — but the mix stayed confusing: there
was no Cancel, and "which edits are live?" had to be learned per section.

**Decision (user-driven).** One rule for the whole panel: everything — fields, the
dependency list, the status selection — is a local draft. Save changes commits it
atomically; Cancel (or closing the panel) discards it; the buttons only render while
the draft differs from the server. List-row quick actions stay instant: a row menu is
a command surface, the panel is an editing surface.

**Atomicity is the hard requirement.** Sequencing the old two endpoints from the
client would allow half-applied saves. Instead PATCH gained an optional
`dependencyIds`, applied in the SAME transaction as fields and the status transition:
dependencies are judged against the current status (A11) and applied first, so
"add dependencies and start" works in one save with the blocked guard evaluating the
NEW set — and any rejection (cycle, blocked, stale version, invariant guard) leaves
nothing applied. This superseded the panel's dependency undo toasts (same day):
Cancel is the universal undo for drafts.

## DL-13 — Calendar view, fed by a per-day aggregation endpoint (2026-07-09)

**Context.** The list view is blind to time distribution — "how loaded is next week"
takes mental arithmetic. A month calendar is the standard answer (Todoist, TickTick,
Notion), and the list API's due-range filters meant most of the groundwork existed.

**Decision.** A second view (`?view=calendar`), month grid. Each day cell shows at
most three tasks plus a "+N more" overflow count — a cell physically fits no more.
The three are chosen by *incomplete before completed, then priority high → low*: the
calendar answers "what needs doing that day", so unfinished work always outranks
finished. Clicking a task opens the detail panel; clicking the day number or the
overflow jumps to the list view filtered to that day (`dueFrom=dueTo`). Past days
with unfinished tasks get the overdue red on the day number — the "only red" rule
extends naturally. Undated tasks simply don't appear.

**The NFR-shaped choice: aggregate in the database.** Fetching a month of raw todos
breaks A9 at scale (the seed alone puts ~1,600 in a month; the list API caps pages at
100 for exactly this reason). Instead `GET /todos/calendar` returns per-day digests —
top 3 via `ROW_NUMBER() OVER (PARTITION BY day ORDER BY …)` plus per-day totals in
one SQL query — so the payload is ~31 rows regardless of how many todos exist.
Grouping, sorting, and truncation happen where the data lives.

**Scope.** Month view only; the calendar honors the status/priority/search filters
(sort and blocked controls hide — they're list concepts). Day boundaries are UTC,
consistent with the documented all-UTC stance.

## What I would do differently with more time

- **Auth** (stretch #1, designed but unbuilt): JWT registration/login with actions
  attributed to users — the list stays shared per the NFR; the activity trail gains
  "who" for free.
- **Cursor pagination** behind the same API shape — offset is measurably fine at 10k
  but degrades linearly; cursors don't.
- **Bulk operations** reusing the same guarded transaction path.
- **Time zones**: everything is UTC today; per-user timezone rendering (and "due
  Friday" semantics across DST) needs a real design pass.
- **Full RRULE recurrence** if users need "last Friday of the month" — the recurrence
  JSON field and the single pure date-math module were shaped so this swaps in without
  schema or API changes.
- **Component tests** for the panel's client-side states if the UI grows real logic
  (optimistic updates, offline queue).
- **Observability**: request metrics and slow-query logging before this meets real
  traffic.


## Measured: 10k-row performance (2026-07-08)

Seeded 10,000 todos (weighted statuses, ±90-day due dates, ~1,300 dependency edges,
5% soft-deleted) and measured p95 over 50 runs per query (M2 MacBook Pro, dockerized
Postgres 16):

| Query | p95 | Threshold |
|-------|-----|-----------|
| Default list (page of 20 + count) | 9.0 ms | 100 ms |
| `blocked=true` (worst case — EXISTS anti-join + tooltip relations) | 20.2 ms | 300 ms |
| Multi-filter + due-date sort, page of 50 | 3.8 ms | 150 ms |

The derived-at-query-time blocked state (D1) costs ~11 ms over the base list at this
scale — the cache-invalidation bugs a stored flag would risk are not worth buying back.
Reproduce with `npm run db:seed && npm run test:perf`.
