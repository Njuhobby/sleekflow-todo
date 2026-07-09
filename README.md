# SleekFlow TODO

A TODO list web application with recurring tasks, task dependencies, filtering/sorting
at 10k+ scale, soft delete, and a per-task activity trail. Built for the SleekFlow
Software Engineer take-home project.

**Stack:** Fastify 5 + Zod + Prisma + PostgreSQL 16 · React 18 + Vite + TanStack Query +
headless Radix primitives · Vitest + Playwright.

> 📄 Start here: [`docs/decision-log.md`](docs/decision-log.md) — how ambiguous
> requirements were interpreted, the key trade-offs, what was cut and why.
> Full working specs live in [`specs/`](specs/).

## Quickstart

Prerequisites: Node 20+, Docker.

```bash
npm ci
cp .env.example .env
docker compose up -d --wait     # Postgres 16 (+ a todo_test database for tests)
npm run db:migrate -w server    # apply migrations
npm run db:seed  -w server      # optional: 10,000 realistic todos
npm run dev:server              # Fastify on :3001  (terminal 1)
npm run dev:web                 # Vite on :5173     (terminal 2)
```

Open http://localhost:5173. API docs (Swagger UI): http://localhost:3001/docs.

### One-container mode

```bash
docker compose --profile full up --build   # db + app (API + built SPA) on :3001
```

## Testing

| Command | What it runs |
|---------|--------------|
| `npm test` | 99 unit + integration tests (integration hits real Postgres, `todo_test` db) |
| `npx playwright test` (in `web/`) | one E2E that walks the full demo flow against the real stack |
| `npm run test:perf -w server` | p95 latency assertions on the hot list queries (needs the 10k seed) |
| `npm run lint` / `npm run typecheck` | ESLint, strict TS across all workspaces |

CI (GitHub Actions) runs lint + typecheck + tests and the E2E on every push.

Measured at 10,000 rows: default list p95 **9 ms**, worst-case blocked filter p95
**20 ms** (details in the decision log).

## Features

- **CRUD** with validation from shared Zod schemas (server and UI enforce the same rules)
- **Recurring tasks** — daily/weekly/monthly with custom intervals; completing spawns
  the next occurrence atomically and idempotently (double-click safe); overdue
  completions skip missed periods without losing the weekday/day-of-month anchor
- **Dependencies** — cycle detection with the path in the error, blocked tasks can't
  start or complete, concurrent writers serialized with row locks (no race can commit
  a dependency cycle or slip past the blocked guard)
- **Explicit status state machine** — reopen and unarchive supported; the UI action
  menus derive from the same transition table the server enforces
- **Filtering/sorting/pagination** — all server-side; status/priority/due-range/
  created-range/blocked/name search; stable pagination at 10k+ items
- **Calendar view** — month grid fed by a per-day aggregation endpoint (top 3 per day
  via a window function + totals), so the payload stays ~31 rows at any list size
- **Soft delete** — delete severs dependency links and is undoable (toast Undo +
  a /trash view); restore can never re-block others or revive a cycle
- **Activity trail** — every mutation appends an event in the same transaction;
  per-task timeline in the UI
- **Concurrency** — optimistic versioning on every write; stale writers get 409 with
  the current state and the UI offers reload

## Project layout

```
specs/        requirements (EARS + ambiguity table), technical design, task plan
docs/         decision log · generated openapi.json
shared/       Zod schemas, error-code catalog, state machine, overdue rule
              (imported by BOTH server and web via the @shared/* path alias)
server/       Fastify app: routes → services (all writes, transactional) → domain
              (pure logic: transitions, cycle detection, recurrence math)
web/          React SPA: list + routed detail panel + trash, one E2E in e2e/
```

## API

Interactive docs at `/docs` (Swagger UI), spec exported to
[`docs/openapi.json`](docs/openapi.json) (`npm run docs:openapi -w server`).

```
GET    /api/todos                   list (filters, sort, pagination)
POST   /api/todos                   create
GET    /api/todos/:id               detail (dependencies, dependents, isBlocked)
PATCH  /api/todos/:id               partial update + guarded status transitions
DELETE /api/todos/:id               soft delete (severs dependency edges)
POST   /api/todos/:id/restore       undelete
PUT    /api/todos/:id/dependencies  replace dependency list (cycle-checked, locked)
GET    /api/todos/:id/activities    event history, newest first
GET    /api/health                  liveness + db ping
```

Errors always use `{ error: { code, message, details } }` with codes from
`shared/src/error-codes.ts`.
