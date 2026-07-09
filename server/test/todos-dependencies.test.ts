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

async function setDeps(id: string, version: number, dependencyIds: string[]) {
  return inject(app, {
    method: "PUT",
    url: `/api/todos/${id}/dependencies`,
    payload: { version, dependencyIds },
  });
}

async function patchStatus(id: string, version: number, status: string) {
  return inject(app, {
    method: "PATCH",
    url: `/api/todos/${id}`,
    payload: { version, status },
  });
}

describe("PUT /api/todos/:id/dependencies", () => {
  it("replaces the list, bumps version, reports isBlocked and records activity", async () => {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });

    const res = await setDeps(b.id, 1, [a.id]);
    expect(res.statusCode).toBe(200);
    const detail = json(res);
    expect(detail.version).toBe(2);
    expect(detail.isBlocked).toBe(true);
    expect(detail.dependencies).toEqual([{ id: a.id, name: "A", status: "not_started" }]);

    const activity = await prisma.activity.findFirst({
      where: { todoId: b.id, type: "dependencies_changed" },
    });
    expect(activity?.payload).toEqual({
      added: [{ id: a.id, name: "A" }],
      removed: [],
    });
  });

  it("dependents see who they block", async () => {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });
    await setDeps(b.id, 1, [a.id]);

    const res = await inject(app, { method: "GET", url: `/api/todos/${a.id}` });
    expect(json(res).dependents).toEqual([{ id: b.id, name: "B", status: "not_started" }]);
  });

  it("rejects self-dependency (R-3.1)", async () => {
    const a = await makeTodo(app);
    const res = await setDeps(a.id, 1, [a.id]);
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe("DEPENDENCY_CYCLE");
  });

  it("rejects deleted or unknown targets with 400 (T-2.2)", async () => {
    const a = await makeTodo(app);
    const b = await makeTodo(app);
    await inject(app, { method: "DELETE", url: `/api/todos/${b.id}` });

    const res = await setDeps(a.id, 1, [b.id]);
    expect(res.statusCode).toBe(400);
    expect(json(res).error.details.invalidDependencyIds).toEqual([b.id]);
  });

  it("rejects edits unless the task is not_started (A11)", async () => {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });
    await patchStatus(b.id, 1, "in_progress");

    const res = await setDeps(b.id, 2, [a.id]);
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe("DEPENDENCY_EDIT_INVALID_STATUS");
  });

  it("duplicate ids in the list are deduplicated (T-2.1)", async () => {
    const a = await makeTodo(app);
    const b = await makeTodo(app);
    const res = await setDeps(b.id, 1, [a.id, a.id, a.id]);
    expect(res.statusCode).toBe(200);
    expect(json(res).dependencies).toHaveLength(1);
  });

  it("rejects a direct cycle with the path in the error (R-3.2)", async () => {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });
    await setDeps(a.id, 1, [b.id]);

    const res = await setDeps(b.id, 1, [a.id]);
    expect(res.statusCode).toBe(400);
    const err = json(res).error;
    expect(err.code).toBe("DEPENDENCY_CYCLE");
    expect(err.details.path).toEqual([b.id, a.id, b.id]);
    expect(err.details.names[a.id]).toBe("A");
  });

  it("rejects a transitive cycle (A→B→C, then C→A)", async () => {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });
    const c = await makeTodo(app, { name: "C" });
    await setDeps(a.id, 1, [b.id]);
    await setDeps(b.id, 1, [c.id]);

    const res = await setDeps(c.id, 1, [a.id]);
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe("DEPENDENCY_CYCLE");
  });

  it("allows a diamond (two paths, no cycle)", async () => {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });
    const c = await makeTodo(app, { name: "C" });
    const d = await makeTodo(app, { name: "D" });
    await setDeps(b.id, 1, [a.id]);
    await setDeps(c.id, 1, [a.id]);

    const res = await setDeps(d.id, 1, [b.id, c.id]);
    expect(res.statusCode).toBe(200);
  });

  it("stale version → 409", async () => {
    const a = await makeTodo(app);
    const b = await makeTodo(app);
    await setDeps(b.id, 1, [a.id]);
    const res = await setDeps(b.id, 1, []);
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe("STALE_VERSION");
  });
});

describe("the blocked guard (R-3.4)", () => {
  it("blocked → in_progress and → completed are rejected with the blockers listed", async () => {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });
    await setDeps(b.id, 1, [a.id]);

    for (const target of ["in_progress", "completed"]) {
      const res = await patchStatus(b.id, 2, target);
      expect(res.statusCode).toBe(409);
      const err = json(res).error;
      expect(err.code).toBe("TODO_BLOCKED");
      expect(err.details.incompleteDependencies).toEqual([
        { id: a.id, name: "A", status: "not_started" },
      ]);
    }
  });

  it("completing the dependency unblocks the dependent", async () => {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });
    await setDeps(b.id, 1, [a.id]);

    await patchStatus(a.id, 1, "completed");
    const res = await patchStatus(b.id, 2, "in_progress");
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ status: "in_progress", isBlocked: false });
  });

  it("archived dependency does NOT satisfy the guard (A4/A12)", async () => {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });
    await setDeps(b.id, 1, [a.id]);
    await patchStatus(a.id, 1, "archived");

    const res = await patchStatus(b.id, 2, "in_progress");
    expect(res.statusCode).toBe(409);
    expect(json(res).error.details.incompleteDependencies[0].status).toBe("archived");
  });

  it("blocked → not_started is never guarded (A10: no trapped tasks)", async () => {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });
    await setDeps(b.id, 1, [a.id]);
    await patchStatus(a.id, 1, "completed");
    await patchStatus(b.id, 2, "completed");
    // reopen the dependency — B is now completed-but-blocked
    await patchStatus(a.id, 2, "in_progress");

    // B can always fall back to not_started…
    const back = await patchStatus(b.id, 3, "not_started");
    expect(back.statusCode).toBe(200);
    // …but not re-complete while blocked
    const complete = await patchStatus(b.id, 4, "completed");
    expect(complete.statusCode).toBe(409);
  });

  it("illegal edges → 400 INVALID_TRANSITION with legal targets listed", async () => {
    const a = await makeTodo(app);
    await patchStatus(a.id, 1, "archived");

    const res = await patchStatus(a.id, 2, "completed");
    expect(res.statusCode).toBe(400);
    const err = json(res).error;
    expect(err.code).toBe("INVALID_TRANSITION");
    expect(err.details.legalTargets).toEqual(["not_started"]);
  });

  it("unarchive goes to not_started, then the normal flow resumes", async () => {
    const a = await makeTodo(app);
    await patchStatus(a.id, 1, "archived");
    const res = await patchStatus(a.id, 2, "not_started");
    expect(res.statusCode).toBe(200);
    expect(json(res).status).toBe("not_started");
  });
});

describe("atomic draft save — PATCH with dependencyIds", () => {
  it("applies fields, dependencies, and a transition in one transaction", async () => {
    const dep = await makeTodo(app, { name: "dep" });
    await patchStatus(dep.id, 1, "completed");
    const t = await makeTodo(app, { name: "T" });

    const res = await inject(app, {
      method: "PATCH",
      url: `/api/todos/${t.id}`,
      payload: {
        version: 1,
        name: "T renamed",
        dependencyIds: [dep.id],
        status: "in_progress",
      },
    });

    expect(res.statusCode).toBe(200);
    const detail = json(res);
    expect(detail).toMatchObject({ name: "T renamed", status: "in_progress" });
    expect(detail.dependencies).toEqual([{ id: dep.id, name: "dep", status: "completed" }]);
  });

  it("rolls back EVERYTHING when one part fails (blocked guard on the new deps)", async () => {
    const dep = await makeTodo(app, { name: "incomplete dep" });
    const t = await makeTodo(app, { name: "T" });

    const res = await inject(app, {
      method: "PATCH",
      url: `/api/todos/${t.id}`,
      payload: {
        version: 1,
        name: "should not persist",
        dependencyIds: [dep.id],
        status: "in_progress",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe("TODO_BLOCKED");

    // nothing happened: no rename, no edges, version untouched
    const detail = json(await inject(app, { method: "GET", url: `/api/todos/${t.id}` }));
    expect(detail).toMatchObject({ name: "T", version: 1, status: "not_started" });
    expect(detail.dependencies).toEqual([]);
  });

  it("dependency changes ride the version guard (deps-only PATCH bumps once)", async () => {
    const dep = await makeTodo(app, { name: "dep" });
    const t = await makeTodo(app, { name: "T" });

    const res = await inject(app, {
      method: "PATCH",
      url: `/api/todos/${t.id}`,
      payload: { version: 1, dependencyIds: [dep.id] },
    });
    expect(res.statusCode).toBe(200);
    expect(json(res).version).toBe(2);

    const stale = await inject(app, {
      method: "PATCH",
      url: `/api/todos/${t.id}`,
      payload: { version: 1, dependencyIds: [] },
    });
    expect(stale.statusCode).toBe(409);
    expect(json(stale).error.code).toBe("STALE_VERSION");
  });

  it("dependencies are judged against the CURRENT status, not the drafted one (A11)", async () => {
    const dep = await makeTodo(app, { name: "dep" });
    const t = await makeTodo(app, { name: "T" });
    await patchStatus(t.id, 1, "in_progress");

    // draft says "back to not_started AND change deps" — deps apply first,
    // against in_progress → rejected, whole save rolls back
    const res = await inject(app, {
      method: "PATCH",
      url: `/api/todos/${t.id}`,
      payload: { version: 2, dependencyIds: [dep.id], status: "not_started" },
    });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe("DEPENDENCY_EDIT_INVALID_STATUS");
    const detail = json(await inject(app, { method: "GET", url: `/api/todos/${t.id}` }));
    expect(detail.status).toBe("in_progress");
  });
});

describe("leaving completed with dependents (R-1.9, A13)", () => {
  /** A completed, B depends on A. Returns [a, b] with fresh versions. */
  async function setup() {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });
    await setDeps(b.id, 1, [a.id]);
    await patchStatus(a.id, 1, "completed"); // a.version = 2
    return { a, b };
  }

  it("reopen and archive are rejected while a dependent is in progress", async () => {
    const { a, b } = await setup();
    await patchStatus(b.id, 2, "in_progress"); // b builds on completed a

    for (const target of ["in_progress", "not_started", "archived"]) {
      const res = await patchStatus(a.id, 2, target);
      expect(res.statusCode, `→ ${target}`).toBe(409);
      const err = json(res).error;
      expect(err.code).toBe("DEPENDENT_IN_PROGRESS");
      expect(err.details.activeDependents).toEqual([
        { id: b.id, name: "B", status: "in_progress" },
      ]);
    }
  });

  it("a completed dependent is history — reopen allowed", async () => {
    const { a, b } = await setup();
    await patchStatus(b.id, 2, "in_progress");
    await patchStatus(b.id, 3, "completed");

    const res = await patchStatus(a.id, 2, "in_progress");
    expect(res.statusCode).toBe(200);
  });

  it("a not_started dependent just re-blocks — reopen allowed", async () => {
    const { a, b } = await setup();

    const res = await patchStatus(a.id, 2, "not_started");
    expect(res.statusCode).toBe(200);

    const detail = json(await inject(app, { method: "GET", url: `/api/todos/${b.id}` }));
    expect(detail.isBlocked).toBe(true); // blocked again, as it should be
  });

  it("the resolution path works: pause the dependent, then reopen", async () => {
    const { a, b } = await setup();
    await patchStatus(b.id, 2, "in_progress");

    expect((await patchStatus(a.id, 2, "not_started")).statusCode).toBe(409);
    await patchStatus(b.id, 3, "not_started"); // pausing is always free (A10)
    expect((await patchStatus(a.id, 2, "not_started")).statusCode).toBe(200);
  });
});

describe("delete cascade (R-1.4, DL-5)", () => {
  it("deleting a dependency severs the edge and unblocks the dependent", async () => {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });
    await setDeps(b.id, 1, [a.id]);

    await inject(app, { method: "DELETE", url: `/api/todos/${a.id}` });

    const detail = json(await inject(app, { method: "GET", url: `/api/todos/${b.id}` }));
    expect(detail.isBlocked).toBe(false);
    expect(detail.dependencies).toEqual([]);

    const res = await patchStatus(b.id, 2, "in_progress");
    expect(res.statusCode).toBe(200);
  });

  it("the deleted todo's activity names the severed links in both directions", async () => {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });
    const c = await makeTodo(app, { name: "C" });
    await setDeps(b.id, 1, [a.id]); // B depends on A
    await setDeps(a.id, 1, [c.id]); // A depends on C

    await inject(app, { method: "DELETE", url: `/api/todos/${a.id}` });

    const activity = await prisma.activity.findFirst({
      where: { todoId: a.id, type: "deleted" },
    });
    const links = (activity?.payload as { severedLinks: unknown[] }).severedLinks;
    expect(links).toEqual(
      expect.arrayContaining([
        { direction: "depends_on", id: c.id, name: "C" },
        { direction: "blocks", id: b.id, name: "B" },
      ])
    );
  });

  it("restore never re-blocks and never revives a cycle (R-1.5)", async () => {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });
    await setDeps(b.id, 1, [a.id]);

    await inject(app, { method: "DELETE", url: `/api/todos/${a.id}` });
    await inject(app, { method: "POST", url: `/api/todos/${a.id}/restore` });

    const bDetail = json(await inject(app, { method: "GET", url: `/api/todos/${b.id}` }));
    expect(bDetail.isBlocked).toBe(false);
    const aDetail = json(await inject(app, { method: "GET", url: `/api/todos/${a.id}` }));
    expect(aDetail.dependencies).toEqual([]);
    expect(aDetail.dependents).toEqual([]);

    // the once-cyclic edge B→A is gone, so A→B is now legal
    const res = await setDeps(a.id, 3, [b.id]);
    expect(res.statusCode).toBe(200);
  });
});

describe("deterministic concurrency (D2, D5)", () => {
  it("transition vs dependency reopen: FOR SHARE serializes them (DL-1)", async () => {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });
    await setDeps(b.id, 1, [a.id]);
    await patchStatus(a.id, 1, "completed"); // B is unblocked now (a.version = 2)

    // T1: hold an uncommitted reopen of A (takes A's row lock)
    let releaseT1!: () => void;
    const t1Gate = new Promise<void>((resolve) => (releaseT1 = resolve));
    const t1 = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE todos SET status = 'in_progress', version = version + 1 WHERE id = ${a.id}`;
      await t1Gate; // hold the lock until told to commit
    });

    await new Promise((r) => setTimeout(r, 50)); // ensure T1 holds the lock

    // T2: B's transition — its FOR SHARE on A must WAIT for T1, then see
    // the reopen and refuse. Without the lock it would read the committed
    // (completed) state, succeed, and break the R-3.4 invariant.
    const t2 = inject(app, {
      method: "PATCH",
      url: `/api/todos/${b.id}`,
      payload: { version: 2, status: "in_progress" },
    });

    await new Promise((r) => setTimeout(r, 150));
    releaseT1();
    await t1;

    const res = await t2;
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe("TODO_BLOCKED");
  });

  it("concurrent reverse-edge writes cannot commit a cycle (D5)", async () => {
    const a = await makeTodo(app, { name: "A" });
    const b = await makeTodo(app, { name: "B" });

    // T1 replays the service's own steps for "A depends on B" and holds the
    // locks uncommitted; T2 (real endpoint) writes "B depends on A".
    let releaseT1!: () => void;
    const t1Gate = new Promise<void>((resolve) => (releaseT1 = resolve));
    const involved = [a.id, b.id].sort();
    const t1 = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM todos WHERE id IN (${involved[0]}, ${involved[1]}) ORDER BY id FOR SHARE`;
      await tx.$executeRaw`INSERT INTO todo_dependencies (dependent_id, dependency_id) VALUES (${a.id}, ${b.id})`;
      await tx.$executeRaw`UPDATE todos SET version = version + 1 WHERE id = ${a.id}`;
      await t1Gate;
    });

    await new Promise((r) => setTimeout(r, 50));

    // T2 must wait on the FOR SHARE (T1's version bump holds A's row
    // exclusively), then see T1's committed edge A→B and reject B→A.
    const t2 = setDeps(b.id, 1, [a.id]);

    await new Promise((r) => setTimeout(r, 150));
    releaseT1();
    await t1;

    const res = await t2;
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe("DEPENDENCY_CYCLE");

    // exactly one direction exists — no mutual block
    const edges = await prisma.todoDependency.findMany();
    expect(edges).toEqual([{ dependentId: a.id, dependencyId: b.id }]);
  });
});
