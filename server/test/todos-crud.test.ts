import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { inject, createTestApp, json, makeTodo, resetDb } from "./helpers.js";

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  app ??= await createTestApp();
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe("POST /api/todos", () => {
  it("creates with defaults and records a `created` activity", async () => {
    const res = await inject(app, {
      method: "POST",
      url: "/api/todos",
      payload: { name: "  Write report  ", dueDate: "2026-07-10T09:00:00.000Z" },
    });

    expect(res.statusCode).toBe(201);
    const todo = json(res);
    expect(todo).toMatchObject({
      name: "Write report", // trimmed
      description: null,
      status: "not_started",
      priority: "medium",
      version: 1,
      recurrence: null,
      deletedAt: null,
      dueDate: "2026-07-10T09:00:00.000Z",
    });

    const activities = await prisma.activity.findMany({ where: { todoId: todo.id } });
    expect(activities).toHaveLength(1);
    expect(activities[0]!.type).toBe("created");
  });

  it("accepts a recurrence", async () => {
    const todo = await makeTodo(app, {
      recurrence: { frequency: "weekly", interval: 2 },
    });
    expect(todo.recurrence).toEqual({ frequency: "weekly", interval: 2 });
  });

  // R-1.2 validation matrix — nothing persists on rejection
  it.each([
    ["empty name", { name: "" }],
    ["whitespace-only name", { name: "   " }],
    ["name over 255 chars", { name: "x".repeat(256) }],
    ["unknown priority", { name: "t", priority: "urgent" }],
    ["malformed due date", { name: "t", dueDate: "tomorrow" }],
    ["recurrence interval 0", { name: "t", recurrence: { frequency: "daily", interval: 0 } }],
    ["unknown recurrence frequency", { name: "t", recurrence: { frequency: "hourly", interval: 1 } }],
    ["status not allowed on create", { name: "t", status: "completed" }],
    ["unknown field", { name: "t", nope: true }],
  ])("rejects %s with 400 VALIDATION", async (_label, payload) => {
    const res = await inject(app, { method: "POST", url: "/api/todos", payload });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe("VALIDATION");
    expect(await prisma.todo.count()).toBe(0);
  });
});

describe("GET /api/todos/:id", () => {
  it("returns the todo", async () => {
    const created = await makeTodo(app);
    const res = await inject(app, { method: "GET", url: `/api/todos/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(json(res).id).toBe(created.id);
  });

  it("404s on unknown id", async () => {
    const res = await inject(app, {
      method: "GET",
      url: "/api/todos/00000000-0000-4000-8000-000000000000",
    });
    expect(res.statusCode).toBe(404);
    expect(json(res).error.code).toBe("NOT_FOUND");
  });

  it("404s on a soft-deleted todo", async () => {
    const created = await makeTodo(app);
    await inject(app, { method: "DELETE", url: `/api/todos/${created.id}` });
    const res = await inject(app, { method: "GET", url: `/api/todos/${created.id}` });
    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /api/todos/:id", () => {
  it("applies partial updates, bumps version, records field-level diff", async () => {
    const created = await makeTodo(app, { name: "old name" });

    const res = await inject(app, {
      method: "PATCH",
      url: `/api/todos/${created.id}`,
      payload: { version: 1, name: "new name", priority: "high" },
    });

    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ name: "new name", priority: "high", version: 2 });

    const activity = await prisma.activity.findFirst({
      where: { todoId: created.id, type: "updated" },
    });
    expect(activity?.payload).toEqual({
      changed: { name: ["old name", "new name"], priority: ["medium", "high"] },
    });
  });

  it("returns 409 STALE_VERSION with current state for a stale writer (D4)", async () => {
    const created = await makeTodo(app);
    await inject(app, {
      method: "PATCH",
      url: `/api/todos/${created.id}`,
      payload: { version: 1, name: "first writer wins" },
    });

    const res = await inject(app, {
      method: "PATCH",
      url: `/api/todos/${created.id}`,
      payload: { version: 1, name: "stale writer" },
    });

    expect(res.statusCode).toBe(409);
    const body = json(res);
    expect(body.error.code).toBe("STALE_VERSION");
    expect(body.error.details.current).toMatchObject({
      name: "first writer wins",
      version: 2,
    });
  });

  it("status changes flow through PATCH behind the guard (T-2.4)", async () => {
    const created = await makeTodo(app);
    const res = await inject(app, {
      method: "PATCH",
      url: `/api/todos/${created.id}`,
      payload: { version: 1, status: "in_progress" },
    });
    expect(res.statusCode).toBe(200);
    expect(json(res).status).toBe("in_progress");

    const activity = await prisma.activity.findFirst({
      where: { todoId: created.id, type: "status_changed" },
    });
    expect(activity?.payload).toEqual({ from: "not_started", to: "in_progress" });
  });

  it("can clear description, dueDate, and recurrence with null", async () => {
    const created = await makeTodo(app, {
      description: "desc",
      dueDate: "2026-07-10T09:00:00.000Z",
      recurrence: { frequency: "daily", interval: 1 },
    });

    const res = await inject(app, {
      method: "PATCH",
      url: `/api/todos/${created.id}`,
      payload: { version: 1, description: null, dueDate: null, recurrence: null },
    });

    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ description: null, dueDate: null, recurrence: null });
  });

  it("404s on unknown or deleted todo", async () => {
    const created = await makeTodo(app);
    await inject(app, { method: "DELETE", url: `/api/todos/${created.id}` });
    const res = await inject(app, {
      method: "PATCH",
      url: `/api/todos/${created.id}`,
      payload: { version: 2, name: "ghost" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE + restore (A5 soft delete)", () => {
  it("soft-deletes: row survives, listing-visible state is gone", async () => {
    const created = await makeTodo(app);
    const res = await inject(app, { method: "DELETE", url: `/api/todos/${created.id}` });
    expect(res.statusCode).toBe(204);

    const row = await prisma.todo.findUnique({ where: { id: created.id } });
    expect(row).not.toBeNull(); // data not permanently lost
    expect(row!.deletedAt).not.toBeNull();

    const deleted = await prisma.activity.findFirst({
      where: { todoId: created.id, type: "deleted" },
    });
    expect(deleted?.payload).toEqual({ severedLinks: [] });
  });

  it("delete of a missing or already-deleted todo → 404", async () => {
    const created = await makeTodo(app);
    await inject(app, { method: "DELETE", url: `/api/todos/${created.id}` });
    const res = await inject(app, { method: "DELETE", url: `/api/todos/${created.id}` });
    expect(res.statusCode).toBe(404);
  });

  it("restore brings the todo back with its previous status", async () => {
    const created = await makeTodo(app);
    await inject(app, { method: "DELETE", url: `/api/todos/${created.id}` });

    const res = await inject(app, {
      method: "POST",
      url: `/api/todos/${created.id}/restore`,
    });

    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ status: "not_started", deletedAt: null });

    const get = await inject(app, { method: "GET", url: `/api/todos/${created.id}` });
    expect(get.statusCode).toBe(200);
  });

  it("restore of a non-deleted todo → 409 NOT_DELETED", async () => {
    const created = await makeTodo(app);
    const res = await inject(app, {
      method: "POST",
      url: `/api/todos/${created.id}/restore`,
    });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe("NOT_DELETED");
  });

  it("full lifecycle leaves a complete activity trail (R-7)", async () => {
    const created = await makeTodo(app);
    await inject(app, {
      method: "PATCH",
      url: `/api/todos/${created.id}`,
      payload: { version: 1, name: "renamed" },
    });
    await inject(app, { method: "DELETE", url: `/api/todos/${created.id}` });
    await inject(app, { method: "POST", url: `/api/todos/${created.id}/restore` });

    const trail = await prisma.activity.findMany({
      where: { todoId: created.id },
      orderBy: { createdAt: "asc" },
    });
    expect(trail.map((a) => a.type)).toEqual(["created", "updated", "deleted", "restored"]);
  });
});
