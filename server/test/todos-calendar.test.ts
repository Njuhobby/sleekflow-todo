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

const JULY = "from=2026-07-01T00:00:00.000Z&to=2026-07-31T23:59:59.999Z";

async function calendar(qs = "") {
  const res = await inject(app, { method: "GET", url: `/api/todos/calendar?${JULY}${qs}` });
  return { status: res.statusCode, body: json(res) };
}

describe("GET /api/todos/calendar (DL-13)", () => {
  it("groups by UTC day with totals; undated and out-of-range excluded", async () => {
    await makeTodo(app, { name: "d9a", dueDate: "2026-07-09T08:00:00Z" });
    await makeTodo(app, { name: "d9b", dueDate: "2026-07-09T22:00:00Z" });
    await makeTodo(app, { name: "d10", dueDate: "2026-07-10T08:00:00Z" });
    await makeTodo(app, { name: "undated" });
    await makeTodo(app, { name: "august", dueDate: "2026-08-01T08:00:00Z" });

    const { status, body } = await calendar();
    expect(status).toBe(200);
    expect(body.days).toHaveLength(2);
    expect(body.days[0]).toMatchObject({ date: "2026-07-09", total: 2, incomplete: 2 });
    expect(body.days[1]).toMatchObject({ date: "2026-07-10", total: 1 });
  });

  it("caps items at 3 with incomplete-first, priority-desc ranking", async () => {
    const due = { dueDate: "2026-07-09T08:00:00Z" };
    const done = await makeTodo(app, { name: "done high", priority: "high", ...due });
    await inject(app, {
      method: "PATCH",
      url: `/api/todos/${done.id}`,
      payload: { version: 1, status: "completed" },
    });
    await makeTodo(app, { name: "open low", priority: "low", ...due });
    await makeTodo(app, { name: "open high", priority: "high", ...due });
    await makeTodo(app, { name: "open medium", priority: "medium", ...due });

    const { body } = await calendar();
    const day = body.days[0];
    expect(day.total).toBe(4);
    expect(day.incomplete).toBe(3);
    expect(day.items).toHaveLength(3);
    // unfinished work outranks the completed high-priority task
    expect(day.items.map((i: { name: string }) => i.name)).toEqual([
      "open high",
      "open medium",
      "open low",
    ]);
  });

  it("honors status/priority/q filters and marks recurring items", async () => {
    await makeTodo(app, {
      name: "weekly ship",
      priority: "high",
      dueDate: "2026-07-09T08:00:00Z",
      recurrence: { frequency: "weekly", interval: 1 },
    });
    await makeTodo(app, { name: "other", priority: "low", dueDate: "2026-07-09T09:00:00Z" });

    const filtered = await calendar("&priority=high&q=ship");
    expect(filtered.body.days).toHaveLength(1);
    expect(filtered.body.days[0].items).toEqual([
      expect.objectContaining({ name: "weekly ship", isRecurring: true }),
    ]);

    const none = await calendar("&status=archived");
    expect(none.body.days).toEqual([]);
  });

  it("soft-deleted todos never appear", async () => {
    const t = await makeTodo(app, { name: "gone", dueDate: "2026-07-09T08:00:00Z" });
    await inject(app, { method: "DELETE", url: `/api/todos/${t.id}` });
    const { body } = await calendar();
    expect(body.days).toEqual([]);
  });

  it("requires a range", async () => {
    const res = await inject(app, { method: "GET", url: "/api/todos/calendar" });
    expect(res.statusCode).toBe(400);
  });
});
