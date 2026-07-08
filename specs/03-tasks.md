# 03 — Task Plan

Ordered, each task small enough to verify independently. `[R-x.y]` traces to requirements,
`(Dn)` to design decisions. Milestones M1–M3 are the "must demo" line; M4–M6 complete the
deliverables; M7 is stretch.

## M0 — Scaffold
- [ ] T-0.1 Monorepo: npm workspaces, `server/` + `web/`, TS config, ESLint/Prettier
- [ ] T-0.2 docker-compose with Postgres 16; `.env.example`
- [ ] T-0.3 Fastify skeleton: app.ts, health route, error-envelope handler [R-6.4]
- [ ] T-0.4 Prisma schema + initial migration (Todo, TodoDependency) — full model up front,
      it's small (D-data-model)
- [ ] T-0.5 Vitest wiring for unit + integration (test DB lifecycle); CI workflow
      ✅ Gate: `docker compose up` + `npm test` green on a hello-world test

## M1 — Core CRUD [R-1]
- [ ] T-1.1 shared/ workspace package: Zod schemas (enums, create/update bodies, list
      query, error envelope) + error-code catalog; server and web both depend on it —
      no hand-copied types anywhere
- [ ] T-1.2 POST /todos + GET /todos/:id [R-1.1, R-1.6, R-1.7]
- [ ] T-1.3 PATCH /todos/:id for non-status fields, with version check → 409 (D4).
      Status changes are rejected until M2 wires the transition guard into this same
      endpoint — avoids shipping an unguarded transition path in M1 and then reworking
      its tests [R-1.3, R-6.1]
- [ ] T-1.4 DELETE (soft) + POST /:id/restore [R-1.4, R-1.5]
- [ ] T-1.5 Integration tests: happy paths, 400 validation matrix, 404s, stale-version
      409, restore on a non-deleted todo → 409
      ✅ Gate: full CRUD lifecycle test passes

## M2 — Dependencies [R-3]
- [ ] T-2.1 domain/dependency-graph.ts: cycle detection (pure) + unit tests: self, direct,
      transitive, diamond-is-legal, duplicate IDs deduplicated (D5) [R-3.1, R-3.2]
- [ ] T-2.2 PUT /todos/:id/dependencies (transactional replace + ordered FOR SHARE lock
      + cycle guard; deleted target → 400; task not in not_started → 409) [R-3.1, R-3.2]
      Test: concurrent reverse-edge writes (A→B ∥ B→A) → exactly one succeeds, the
      other gets 400 with the cycle path — driven deterministically (hold the first
      transaction open, assert the second blocks, then commit)
- [ ] T-2.2a Delete cascade: soft delete removes the task's dependency edges (both
      directions) in the same transaction; restore returns the task without links;
      tests: delete unblocks dependents, restore does not re-block them, restore can
      never produce a cycle [R-1.4, R-1.5, R-3.5]
- [ ] T-2.3 domain/transitions.ts: guard table + unit tests covering every edge of the
      R-1.8 state machine incl. reopen re-runs blocked guard, unarchive → not_started,
      illegal edges → 400 (D2) [R-1.8, R-3.4]
- [ ] T-2.4 Wire status transitions into PATCH behind the guard (completes T-1.3);
      isBlocked in the DETAIL response — the list-side isBlocked and blocked filter land
      with T-4.2, once GET /todos exists (D1, D2) [R-3.3, R-3.5]
- [ ] T-2.5 Integration: blocked → PATCH in_progress → 409 with dependency IDs; complete
      the dependency → transition succeeds; deleting a dependency unblocks (edge gone);
      concurrency: transition B vs reopen of its dependency A — driven deterministically
      (open the reopen transaction, hold it, issue B's transition, assert it waits/409s,
      commit) rather than firing parallel requests and hoping for the interleaving (D2)
      ✅ Gate: end-to-end blocked-flow test passes

## M3 — Recurrence [R-2]
- [ ] T-3.1 domain/recurrence.ts: next-due-date math (use date-fns; its addMonths clamps
      month-end natively) + unit tests: daily/weekly/monthly, interval N, month-end clamp,
      undated task spawns undated occurrence, overdue completion skips missed periods (k > 1) while keeping
      the cadence anchor [R-2.1, R-2.2, R-2.3, R-2.5]
- [ ] T-3.2 Completion hook in service: transactional spawn (D3) [R-2.2, R-2.6]
- [ ] T-3.3 Integration: complete → exactly one new occurrence; double-complete race →
      still exactly one, driven deterministically (both writers read the same version,
      first UPDATE wins, second matches 0 rows → 409 — assert by construction, plus a
      looped parallel-request smoke run); archiving a recurring TODO does NOT spawn
      [R-2.4, R-1.8]
      ✅ Gate: race test passes — **this is the hardest test in the project, budget time**

## M4 — Listing at scale [R-4, R-6.3]
- [ ] T-4.1 GET /todos filters: status[], priority[], due range, q (name substring,
      ILIKE — also serves the dependency picker), includeDeleted [R-4.1]
- [ ] T-4.2 blocked=true/false via EXISTS subquery (D1) [R-4.1]
- [ ] T-4.3 Sorting (priority as ordinal, stable id tiebreak) + offset pagination with
      total (D6) [R-4.2, R-4.3]
- [ ] T-4.3a Edge tests: page beyond last → empty page (200, not error); pageSize > 100
      → 400; dueBefore > dueAfter → empty result (valid query, not 400)
- [ ] T-4.4 Seed script: 10,000 todos with realistic spread + dependency clusters
- [ ] T-4.5 Perf test: p95 default list + worst-case blocked filter under threshold;
      separate `npm run test:perf` script (needs the 10k seed), not part of the default
      CI job — keeps the regular test feedback loop fast [R-6.3]
      ✅ Gate: perf numbers recorded (they go in the decision log)

## M5 — Web UI [R-5]
- [ ] T-5.1 Vite scaffold, typed API client + TanStack Query hooks (shared Zod types)
- [ ] T-5.2 List page: table, status/priority badges, blocked 🔒 + tooltip, pagination
- [ ] T-5.3 FilterBar (status, priority, due range, blocked) + sort controls — state in
      URL params so demo links are shareable
- [ ] T-5.4 Create/edit modal: validation errors inline, recurrence editor, dependency
      picker (search-select of existing todos; only enabled while the task is
      not_started, per A11)
- [ ] T-5.5 Row actions: start / complete / archive / delete / restore; 409 conflict and
      blocked errors surfaced with reason [R-5.4]
- [ ] T-5.6 One Playwright E2E that IS the demo script: create two todos → add dependency
      → start blocked task rejected with visible reason → complete the dependency → start
      → complete → recurring next-occurrence appears. Runs against docker-compose stack
      in CI. (eng-review decision: this instead of a component-test suite — it verifies
      the exact flow presented in the interview)
      ✅ Gate: every API feature reachable from the UI + E2E green

## M6 — Deliverables hardening
- [ ] T-6.1 README: quickstart (docker compose up → seed → open), dev workflow, test matrix
- [ ] T-6.2 Export openapi.json in CI; verify Swagger UI at /docs
- [ ] T-6.3 docs/decision-log.md: final polish only — the log has been written
      decision-by-decision since the spec review; trim to 1–2 pages, verify
      cross-references to specs/ still hold, add the more-time list
- [ ] T-6.4 Dockerfiles for api + web; compose runs the full stack
- [ ] T-6.5 Demo dry run: fresh clone → running app, rehearse the blocked-flow and
      recurrence demo script

## M7 — Stretch (only if M0–M6 done)
- [ ] T-7.1 Real-time list updates via SSE (single channel, invalidate-on-event)
- [ ] T-7.2 Bulk complete/delete with transactional guard reuse
- [ ] T-7.3 Cursor pagination behind the same API shape

## Suggested sequencing note

M2 (dependencies) before M3 (recurrence) because transitions.ts (T-2.3) must exist before
the completion hook (T-3.2) — completing a blocked recurring task must be rejected, not
spawn an occurrence.
