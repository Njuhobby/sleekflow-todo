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

async function list(qs = "") {
  const res = await app.inject({ method: "GET", url: `/api/todos${qs}` });
  return { status: res.statusCode, body: json(res) };
}

describe("GET /api/todos — filters (R-4.1)", () => {
  it("filters by status (multi, both CSV and repeated params)", async () => {
    const a = await makeTodo(app, { name: "A" });
    await makeTodo(app, { name: "B" });
    await app.inject({
      method: "PATCH",
      url: `/api/todos/${a.id}`,
      payload: { version: 1, status: "in_progress" },
    });

    const csv = await list("?status=in_progress,completed");
    expect(csv.body.items.map((t: { name: string }) => t.name)).toEqual(["A"]);
    const repeated = await list("?status=in_progress&status=completed");
    expect(repeated.body.total).toBe(1);
  });

  it("filters by priority and due-date range", async () => {
    await makeTodo(app, { name: "low far", priority: "low", dueDate: "2026-09-01T00:00:00Z" });
    await makeTodo(app, { name: "high soon", priority: "high", dueDate: "2026-07-10T00:00:00Z" });

    const byPriority = await list("?priority=high");
    expect(byPriority.body.items[0].name).toBe("high soon");

    const byRange = await list(
      "?dueAfter=2026-08-01T00:00:00Z&dueBefore=2026-10-01T00:00:00Z"
    );
    expect(byRange.body.items[0].name).toBe("low far");
  });

  it("q searches name case-insensitively (dependency picker path)", async () => {
    await makeTodo(app, { name: "Deploy Staging" });
    await makeTodo(app, { name: "Write docs" });
    const res = await list("?q=deploy");
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].name).toBe("Deploy Staging");
  });

  it("blocked=true / blocked=false partition correctly; archived dep still blocks", async () => {
    const dep = await makeTodo(app, { name: "dep" });
    const blocked = await makeTodo(app, { name: "blocked" });
    await makeTodo(app, { name: "free" });
    await app.inject({
      method: "PUT",
      url: `/api/todos/${blocked.id}/dependencies`,
      payload: { version: 1, dependencyIds: [dep.id] },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/todos/${dep.id}`,
      payload: { version: 1, status: "archived" },
    });

    const blockedRes = await list("?blocked=true");
    expect(blockedRes.body.items.map((t: { name: string }) => t.name)).toEqual(["blocked"]);
    // tooltip data rides the list response, archived blocker visible (A12)
    expect(blockedRes.body.items[0].incompleteDependencies).toEqual([
      { id: dep.id, name: "dep", status: "archived" },
    ]);

    const freeRes = await list("?blocked=false");
    expect(freeRes.body.items.map((t: { name: string }) => t.name).sort()).toEqual([
      "dep",
      "free",
    ]);
  });

  it("deleted=true is the trash view; default excludes deleted", async () => {
    const a = await makeTodo(app, { name: "kept" });
    const b = await makeTodo(app, { name: "trashed" });
    await app.inject({ method: "DELETE", url: `/api/todos/${b.id}` });

    const main = await list();
    expect(main.body.items.map((t: { name: string }) => t.name)).toEqual(["kept"]);
    const trash = await list("?deleted=true");
    expect(trash.body.items.map((t: { name: string }) => t.name)).toEqual(["trashed"]);
    expect(a.id).toBeTruthy();
  });
});

describe("GET /api/todos — sorting (R-4.2)", () => {
  it("sorts by priority in enum order with stable id tiebreak", async () => {
    await makeTodo(app, { name: "m", priority: "medium" });
    await makeTodo(app, { name: "h", priority: "high" });
    await makeTodo(app, { name: "l", priority: "low" });

    const asc = await list("?sortBy=priority&order=asc");
    expect(asc.body.items.map((t: { name: string }) => t.name)).toEqual(["l", "m", "h"]);
  });

  it("sorts by due date with undated rows always last", async () => {
    await makeTodo(app, { name: "undated" });
    await makeTodo(app, { name: "later", dueDate: "2026-09-01T00:00:00Z" });
    await makeTodo(app, { name: "sooner", dueDate: "2026-07-10T00:00:00Z" });

    const asc = await list("?sortBy=dueDate&order=asc");
    expect(asc.body.items.map((t: { name: string }) => t.name)).toEqual([
      "sooner",
      "later",
      "undated",
    ]);
    const desc = await list("?sortBy=dueDate&order=desc");
    expect(desc.body.items.map((t: { name: string }) => t.name)).toEqual([
      "later",
      "sooner",
      "undated",
    ]);
  });

  it("sorts by name", async () => {
    await makeTodo(app, { name: "banana" });
    await makeTodo(app, { name: "apple" });
    const res = await list("?sortBy=name&order=asc");
    expect(res.body.items.map((t: { name: string }) => t.name)).toEqual(["apple", "banana"]);
  });
});

describe("GET /api/todos — pagination edges (T-4.3a)", () => {
  it("paginates with total; page beyond last is an empty 200, not an error", async () => {
    for (let i = 0; i < 5; i++) await makeTodo(app, { name: `t${i}` });

    const p1 = await list("?page=1&pageSize=2");
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.total).toBe(5);

    const beyond = await list("?page=99&pageSize=2");
    expect(beyond.status).toBe(200);
    expect(beyond.body.items).toEqual([]);
    expect(beyond.body.total).toBe(5);
  });

  it("pageSize above 100 → 400 VALIDATION", async () => {
    const res = await list("?pageSize=101");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION");
  });

  it("dueBefore earlier than dueAfter → empty result, not an error", async () => {
    await makeTodo(app, { dueDate: "2026-07-10T00:00:00Z" });
    const res = await list("?dueBefore=2026-01-01T00:00:00Z&dueAfter=2026-06-01T00:00:00Z");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it("no row is duplicated or skipped across pages (stable tiebreak)", async () => {
    for (let i = 0; i < 7; i++) await makeTodo(app, { name: "same", priority: "medium" });

    const seen = new Set<string>();
    for (let page = 1; page <= 4; page++) {
      const res = await list(`?sortBy=priority&order=asc&page=${page}&pageSize=2`);
      for (const item of res.body.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
    }
    expect(seen.size).toBe(7);
  });
});
