# 02 — Technical Design

Traces to requirement IDs in `01-requirements.md`.

## Stack

| Layer | Choice | Trade-off considered |
|-------|--------|----------------------|
| Backend | Node.js 20 + TypeScript + **Fastify** | vs Express: Fastify gives first-class JSON-schema validation and auto-generated OpenAPI (`@fastify/swagger`) — directly satisfies the API-docs deliverable. vs NestJS: too much ceremony for this size |
| Validation | **Zod** + `fastify-type-provider-zod` | Single source of truth: request schemas → runtime validation → TS types → OpenAPI. Known footgun: `.transform()` in **response** schemas breaks generated OpenAPI (fields render as empty objects, turkerdev/fastify-type-provider-zod#208) — rule: transforms/coercion on input schemas only, response schemas stay plain |
| ORM | **Prisma** | Type-safe queries, migrations, easy seeding; raw SQL escape hatch for the couple of hot queries |
| Database | **PostgreSQL 16** (Docker) | vs SQLite: real concurrent writers (R-6.1) and production realism; vs MongoDB: dependencies and filtered/sorted listings are relational workloads |
| Frontend | **React 18 + Vite + TypeScript** | Industry default; TanStack Query for server state (caching, optimistic updates, error surfacing) |
| Tests | **Vitest** + `app.inject()` (integration) | One runner for both packages; integration tests hit real routes against a test DB |
| Dev/Ops | docker-compose (db + api + web), GitHub Actions CI | Nice-to-have with high demo value, low cost |

## Repository layout (monorepo, npm workspaces)

```
sleekflow-todo/
├── specs/               # 01-requirements, 02-design, 03-tasks (this SDD trio)
├── shared/              # workspace package: Zod schemas, inferred TS types, error-code
│                        # catalog (TODO_BLOCKED, INVALID_TRANSITION, STALE_VERSION,
│                        # DEPENDENCY_CYCLE, VALIDATION, NOT_FOUND) — single source for
│                        # server validation and web display; no hand-copied types
├── server/
│   ├── prisma/          # schema.prisma, migrations, seed.ts (10k seeder)
│   └── src/
│       ├── app.ts       # Fastify assembly (plugins, swagger, error handler)
│       ├── routes/      # todos.routes.ts — thin: parse → call service → serialize
│       ├── services/    # todo.service.ts — transactions, orchestration
│       ├── domain/      # pure logic: recurrence.ts, dependency-graph.ts, transitions.ts
│       └── lib/         # prisma client, error types, pagination helpers
├── web/
│   └── src/
│       ├── api/         # typed client + TanStack Query hooks
│       ├── components/  # TodoList, TodoForm, FilterBar, DependencyPicker
│       └── pages/
├── docs/                # decision-log.md; openapi.json exported by CI
├── docker-compose.yml
└── README.md
```

**Layering rule:** `domain/` is pure functions (no I/O) — recurrence date math, cycle
detection, status-transition rules. This is where the interview-critical logic lives, unit
tested exhaustively. `services/` wraps domain logic in Prisma transactions. `routes/` do
HTTP only. This is the main testability argument for the demo.

## Data model

```prisma
model Todo {
  id          String    @id @default(uuid)
  name        String    @db.VarChar(255)
  description String?
  dueDate     DateTime?
  status      Status    @default(NOT_STARTED)
  priority    Priority  @default(MEDIUM)   // enum declared LOW, MEDIUM, HIGH — Postgres
                                           // sorts enums by declaration order, so
                                           // ORDER BY priority needs no mapping
  version     Int       @default(1)        // optimistic concurrency (R-6.1)
  deletedAt   DateTime?                    // soft delete (R-1.4)
  recurrence  Json?                        // { frequency, interval } (R-2.1)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  dependencies TodoDependency[] @relation("dependent")   // tasks this one waits on
  dependents   TodoDependency[] @relation("dependency")

  @@index([deletedAt, status])
  @@index([deletedAt, priority])
  @@index([deletedAt, dueDate])
}

model TodoDependency {
  dependentId  String   // the blocked task
  dependencyId String   // the task it waits on
  @@id([dependentId, dependencyId])
  @@index([dependencyId])
}
```

Notes:
- `recurrence` as JSON, not columns: it's an opaque value object owned by domain code;
  never filtered on in SQL.
- Composite indexes lead with `deletedAt` because every query filters it (R-6.3).
- `blocked` is **computed, not stored** — see below.

## Key design decisions

### D1 — Blocked state is derived at query time (R-3.3, R-4.1)
Storing a `blocked` flag denormalizes state that changes as a *side effect* of other rows
changing (completing task A unblocks B, C, D) — a classic consistency trap under concurrent
writers. Instead:
- Detail/list responses compute `isBlocked` via a LEFT JOIN against incomplete,
  non-deleted dependencies.
- Filter `blocked=true/false` becomes an `EXISTS` / `NOT EXISTS` subquery — index-assisted,
  fine at 10k rows (verified in perf test, T-4.5).
- The list response carries each row's incomplete dependencies (`{id, name}[]`) for the
  blocked tooltip — fetched in the SAME query via aggregate JOIN. Per-row lookups (N+1)
  are explicitly forbidden here; at pageSize 20 that would be 21 queries per page load.
- Trade-off: slightly more complex list query vs zero cache-invalidation bugs. At this
  scale, correctness wins.

### D2 — Status transitions are guarded in one place (R-3.4, R-1.8)
`domain/transitions.ts` owns the rule table below. The service loads the TODO + its
incomplete dependencies **inside a transaction**, calls the pure guard, then writes.
No route can bypass it. This diagram also goes into a code comment in transitions.ts.

```
                 ┌──────────────── unarchive ────────────────┐
                 ▼                                            │
          not_started ◄────────► in_progress             archived
              │  ▲                    │                       ▲
              │  │ reopen             ▼          archive      │
              │  └─────────────── completed ──────────────────┤
              │                       ▲  (any non-archived) ──┘
              └── direct complete ────┘

  ▸ edges into in_progress / completed run the blocked guard (R-3.4)
  ▸ reopen of a recurring TODO does NOT retract the spawned next occurrence
  ▸ everything else → 400 INVALID_TRANSITION
```

**Race protection (eng-review decision):** the transaction takes `SELECT … FOR SHARE`
(via `$queryRaw`) on the dependency rows before the guard check. Without it, under
READ COMMITTED two concurrent writers can interleave: B moves to In Progress while its
dependency A is simultaneously reopened — both commit, violating the R-3.4 invariant.
FOR SHARE blocks concurrent UPDATEs to the dependency rows until the transition commits,
while still allowing concurrent readers (and other FOR SHARE holders), so parallel
transitions of different tasks sharing a dependency don't serialize. FOR UPDATE would be
needlessly exclusive; SERIALIZABLE would require retry handling for the same guarantee.

### D3 — Recurrence spawning is transactional and idempotent (R-2.2, R-2.4)
Completing a recurring TODO does, in ONE transaction:
1. `UPDATE todo SET status='completed', version=version+1 WHERE id=? AND version=?`
   — the optimistic version check (D4) doubles as the idempotency guard: a concurrent or
   repeated completion sees 0 rows updated → 409, no second occurrence.
2. Insert the next occurrence (due date from `domain/recurrence.ts`, including the
   Jan-31 → Feb-28/29 clamp, R-2.5).

Alternative considered: a scheduler/cron that materializes occurrences ahead of time —
rejected: it introduces a background component to deploy and reason about, and the brief
only requires spawn-on-completion.

### D4 — Optimistic concurrency via `version` (R-6.1)
Every PATCH carries the version it read (`If-Match`-style, in the body). Update is
`WHERE id = ? AND version = ?`; zero rows affected → 409 with the current server state so
the UI can show "someone else changed this — reload". Pessimistic locks rejected: no
long-running edits, and lost updates only need detection here, not prevention.

### D5 — Cycle detection at write time (R-3.2, A11)
On dependency change, walk the dependency graph (DFS from each new dependency toward the
dependent) inside the same transaction that writes the links. O(V+E) on the reachable
subgraph — trivial at this scale. Detected cycle returns the path in the 400 body for
a good error UX.

**Race protection (eng-review decision, same pattern as D2):** the dependency-write
transaction first takes `SELECT … FOR SHARE` on all involved task rows (the dependent +
every new dependency), **ordered by id** so two overlapping writers always acquire locks
in the same order (no deadlock). Concurrent reverse-edge writes (A→B and B→A) therefore
serialize, and the second transaction's cycle walk sees the first's committed edges →
400. Without this, both DFS checks pass against pre-commit state and a permanent
mutual-block cycle lands.

Two further rules keep the graph permanently clean (eng-review decisions):
- Dependency edits are rejected (409) unless the dependent task is `not_started` —
  "blocked but already in progress" states are impossible by construction, and the UI
  only offers the dependency picker on not-started tasks.
- Soft-deleting a task hard-deletes its dependency edges in the same transaction
  (R-1.4), so the graph only ever contains live tasks: cycle detection needs no
  deleted-node special case, and restore can never revive a cycle.

### D6 — Pagination is offset-based (R-4.3)
Offset/limit + total count: simple, supports "jump to page" UI, fine at 10k rows.
Cursor pagination is the more-time answer (noted in decision log); at 10k items offset
cost is negligible.

## API surface (OpenAPI is generated from these route schemas)

```
GET    /api/todos                 list; query: status[], priority[], dueBefore, dueAfter,
                                  blocked, includeDeleted, sortBy, order, page, pageSize
POST   /api/todos                 create
GET    /api/todos/:id             detail (includes dependencies, dependents, isBlocked)
PATCH  /api/todos/:id             partial update; body carries `version`; 409 on stale
DELETE /api/todos/:id             soft delete; removes its dependency edges (both
                                  directions) in the same transaction
POST   /api/todos/:id/restore     undelete; comes back without dependency links
PUT    /api/todos/:id/dependencies  replace dependency list; body carries `version`
                                  (bumps it — a dependency change IS an edit); 400 on
                                  cycle/self/deleted-target, 409 on stale version or
                                  when the task is not `not_started` (A11)
GET    /api/health                liveness + db ping
GET    /docs                      Swagger UI
```

Status changes go through PATCH (`{ status, version }`) so there is exactly one guarded
write path (D2). Error envelope everywhere:
`{ error: { code: "TODO_BLOCKED", message, details: { incompleteDependencies: [...] } } }`.

## Web UI plan (R-5)

Dev setup: Vite's dev server proxies `/api` to the Fastify port, so no CORS
configuration is needed in either environment (prod serves the built SPA from the API).

Single-page list + modal form. TanStack Query keys mirror API query params, so filter
changes are cache-keyed refetches. Blocked rows show a 🔒 with tooltip listing incomplete
dependencies (data already in the list response — no N+1 requests). 409s surface as
inline "reload" prompts. Pagination controls rather than virtualization — the server
never sends more than one page (A9), so the DOM stays small by construction.

## Test strategy (maps to "meaningful scenarios, including edge cases")

- **Unit (domain/):** recurrence date math (month-end clamp, interval > 1, no due date),
  cycle detection (self, direct, transitive, diamond — diamond is legal), transition
  guard table.
- **Integration (routes + real Postgres):** CRUD happy paths; validation failures;
  soft delete → list exclusion → restore; blocked 409 flow end-to-end; complete recurring
  → next occurrence exists exactly once (including a two-parallel-requests race test);
  version conflict 409; every filter/sort combination smoke-tested.
- **E2E (Playwright, one test):** the interview demo script itself — create → blocked by
  dependency → unblock → complete → recurring spawn visible. Frontend component tests
  deliberately skipped (decision log DL-4).
- **Perf check:** seed 10k, assert p95 of the default list query under a threshold.
- CI: lint + typecheck + unit + integration (Postgres service container) + E2E.
