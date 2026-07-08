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
2. T-4.5 perf test (the 10k seed script stays — it's needed for manual verification)
3. T-6.4 app Dockerfiles (Postgres compose service stays)
4. T-5.6 Playwright E2E (falls back to a written manual demo checklist)
5. UI conveniences: URL-synced filter state, restore-from-deleted view
---
Never cut: CRUD + soft delete/restore, dependencies with guard + locks, recurrence with
idempotent spawn, list filters/sort/pagination at 10k, the simple UI over all of it,
tests for the above, README, OpenAPI docs, this decision log.
