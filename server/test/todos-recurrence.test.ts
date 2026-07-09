import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, json, makeTodo, resetDb } from "./helpers.js";

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  app ??= await createTestApp();
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

const WEEKLY = { frequency: "weekly", interval: 1 };

async function complete(id: string, version: number) {
  return app.inject({
    method: "PATCH",
    url: `/api/todos/${id}`,
    payload: { version, status: "completed" },
  });
}

describe("recurrence spawning (R-2.2, D3)", () => {
  it("completing spawns exactly one next occurrence with the shifted due date", async () => {
    const future = new Date(Date.now() + 48 * 3600 * 1000); // due in 2 days
    const todo = await makeTodo(app, {
      name: "Weekly report",
      description: "every friday",
      priority: "high",
      dueDate: future.toISOString(),
      recurrence: WEEKLY,
    });

    const res = await complete(todo.id, 1);
    expect(res.statusCode).toBe(200);

    const spawned = await prisma.todo.findMany({
      where: { id: { not: todo.id } },
    });
    expect(spawned).toHaveLength(1);
    const next = spawned[0]!;
    expect(next).toMatchObject({
      name: "Weekly report",
      description: "every friday",
      priority: "high",
      status: "not_started",
      version: 1,
      recurrence: WEEKLY,
    });
    expect(next.dueDate!.getTime()).toBe(future.getTime() + 7 * 24 * 3600 * 1000);

    // activity on both sides of the spawn (R-7.1)
    const source = await prisma.activity.findFirst({
      where: { todoId: todo.id, type: "spawned_next" },
    });
    expect(source?.payload).toMatchObject({ nextId: next.id });
    const born = await prisma.activity.findFirst({
      where: { todoId: next.id, type: "created_from_recurrence" },
    });
    expect(born?.payload).toMatchObject({ sourceId: todo.id });
  });

  it("double-complete cannot spawn twice — version guard is the idempotency (R-2.4)", async () => {
    const todo = await makeTodo(app, { recurrence: WEEKLY });

    // Deterministic by construction: both writers read version 1; whichever
    // lands second matches zero rows. Order doesn't matter.
    const [r1, r2] = await Promise.all([complete(todo.id, 1), complete(todo.id, 1)]);
    const statuses = [r1.statusCode, r2.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const spawned = await prisma.todo.count({ where: { id: { not: todo.id } } });
    expect(spawned).toBe(1);
  });

  it("sequential re-complete after reopen spawns again — that's a real second cycle", async () => {
    const todo = await makeTodo(app, { recurrence: WEEKLY });
    await complete(todo.id, 1); // spawn #1
    await app.inject({
      method: "PATCH",
      url: `/api/todos/${todo.id}`,
      payload: { version: 2, status: "in_progress" }, // reopen
    });
    await complete(todo.id, 3); // spawn #2 — legitimate

    const spawned = await prisma.todo.count({ where: { id: { not: todo.id } } });
    expect(spawned).toBe(2);
  });

  it("reopening after a spawn does NOT retract the spawned occurrence (A10)", async () => {
    const todo = await makeTodo(app, { recurrence: WEEKLY });
    await complete(todo.id, 1);

    const reopen = await app.inject({
      method: "PATCH",
      url: `/api/todos/${todo.id}`,
      payload: { version: 2, status: "not_started" },
    });
    expect(reopen.statusCode).toBe(200);
    expect(await prisma.todo.count()).toBe(2); // both alive
  });

  it("archiving a recurring todo does NOT spawn (A12)", async () => {
    const todo = await makeTodo(app, { recurrence: WEEKLY });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/todos/${todo.id}`,
      payload: { version: 1, status: "archived" },
    });
    expect(res.statusCode).toBe(200);
    expect(await prisma.todo.count()).toBe(1);
  });

  it("a blocked recurring todo cannot complete, so nothing spawns (M2×M3)", async () => {
    const dep = await makeTodo(app, { name: "dep" });
    const todo = await makeTodo(app, { recurrence: WEEKLY });
    await app.inject({
      method: "PUT",
      url: `/api/todos/${todo.id}/dependencies`,
      payload: { version: 1, dependencyIds: [dep.id] },
    });

    const res = await complete(todo.id, 2);
    expect(res.statusCode).toBe(409);
    expect(await prisma.todo.count()).toBe(2); // no third row
  });

  it("undated recurring todo spawns an undated occurrence (R-2.3)", async () => {
    const todo = await makeTodo(app, { recurrence: WEEKLY }); // no dueDate
    await complete(todo.id, 1);

    const next = await prisma.todo.findFirst({ where: { id: { not: todo.id } } });
    expect(next!.dueDate).toBeNull();
  });

  it("overdue completion skips missed periods, keeping the anchor (A2)", async () => {
    const threeWeeksAgo = new Date(Date.now() - 21 * 24 * 3600 * 1000);
    const todo = await makeTodo(app, {
      dueDate: threeWeeksAgo.toISOString(),
      recurrence: WEEKLY,
    });
    await complete(todo.id, 1);

    const next = await prisma.todo.findFirst({ where: { id: { not: todo.id } } });
    const due = next!.dueDate!;
    expect(due.getTime()).toBeGreaterThan(Date.now()); // never spawns already-overdue
    expect(due.getUTCDay()).toBe(threeWeeksAgo.getUTCDay()); // same weekday anchor
    // exactly one occurrence despite three missed periods
    expect(await prisma.todo.count()).toBe(2);
  });

  it("non-recurring completion spawns nothing", async () => {
    const todo = await makeTodo(app);
    await complete(todo.id, 1);
    expect(await prisma.todo.count()).toBe(1);
  });

  it("giving a completed todo its FIRST recurrence spawns immediately (A15)", async () => {
    const todo = await makeTodo(app); // no recurrence
    await complete(todo.id, 1); // completes, spawns nothing
    expect(await prisma.todo.count()).toBe(1);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/todos/${todo.id}`,
      payload: { version: 2, recurrence: WEEKLY },
    });
    expect(res.statusCode).toBe(200);

    const spawned = await prisma.todo.findMany({ where: { id: { not: todo.id } } });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!).toMatchObject({ status: "not_started", recurrence: WEEKLY });

    const activity = await prisma.activity.findFirst({
      where: { todoId: todo.id, type: "spawned_next" },
    });
    expect(activity).not.toBeNull();
  });

  it("EDITING an existing recurrence on a completed todo does not re-spawn", async () => {
    const todo = await makeTodo(app, { recurrence: WEEKLY });
    await complete(todo.id, 1); // spawns #1
    expect(await prisma.todo.count()).toBe(2);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/todos/${todo.id}`,
      payload: { version: 2, recurrence: { frequency: "monthly", interval: 1 } },
    });
    expect(res.statusCode).toBe(200);
    expect(await prisma.todo.count()).toBe(2); // still just the one spawn
  });

  it("recurrence added to a NON-completed todo stays dormant", async () => {
    const todo = await makeTodo(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/todos/${todo.id}`,
      payload: { version: 1, recurrence: WEEKLY },
    });
    expect(res.statusCode).toBe(200);
    expect(await prisma.todo.count()).toBe(1);
  });
});

describe("GET /api/todos/:id/activities (R-7)", () => {
  it("returns the trail newest-first with pagination", async () => {
    const todo = await makeTodo(app, { recurrence: WEEKLY });
    await app.inject({
      method: "PATCH",
      url: `/api/todos/${todo.id}`,
      payload: { version: 1, name: "renamed" },
    });
    await complete(todo.id, 2);

    const res = await app.inject({
      method: "GET",
      url: `/api/todos/${todo.id}/activities?pageSize=2`,
    });
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body.total).toBe(4); // created, updated, status_changed, spawned_next
    expect(body.items).toHaveLength(2);
    const types = body.items.map((a: { type: string }) => a.type);
    // newest first: the completion pair comes before rename/create
    expect(types).toEqual(expect.arrayContaining(["spawned_next", "status_changed"]));

    const page2 = json(
      await app.inject({
        method: "GET",
        url: `/api/todos/${todo.id}/activities?page=2&pageSize=2`,
      })
    );
    expect(page2.items.map((a: { type: string }) => a.type)).toEqual(["updated", "created"]);
  });

  it("history remains readable for a soft-deleted todo (R-7.2)", async () => {
    const todo = await makeTodo(app);
    await app.inject({ method: "DELETE", url: `/api/todos/${todo.id}` });

    const res = await app.inject({ method: "GET", url: `/api/todos/${todo.id}/activities` });
    expect(res.statusCode).toBe(200);
    expect(json(res).items.map((a: { type: string }) => a.type)).toEqual([
      "deleted",
      "created",
    ]);
  });

  it("404s for a todo that never existed", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/todos/00000000-0000-4000-8000-000000000000/activities",
    });
    expect(res.statusCode).toBe(404);
  });
});
