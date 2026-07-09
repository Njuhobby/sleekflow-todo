import { Prisma } from "@prisma/client";
import type { Todo as DbTodo } from "@prisma/client";
import type { SetDependencies } from "@shared/todo-schemas";
import { ErrorCodes } from "@shared/error-codes";
import { prisma } from "../lib/prisma.js";
import { AppError, NotFoundError } from "../lib/errors.js";
import { logActivity } from "../lib/activity.js";
import type { Actor } from "../lib/activity.js";
import { findCycle } from "../domain/dependency-graph.js";
import { getTodoDetail } from "./todo.service.js";

interface LockedRow {
  id: string;
  name: string;
  status: string;
  deletedAt: Date | null;
}

/**
 * Replace a todo's dependency list inside an ambient transaction (R-3.1,
 * R-3.2, A11). Used by the PUT endpoint and by PATCH's atomic draft save.
 *
 * Concurrency (D5): all involved rows are locked FOR SHARE **ordered by id**
 * before the cycle walk. Two overlapping writers (A→B ∥ B→A) therefore
 * serialize — the second walk sees the first's committed edges and rejects
 * the cycle. Ordering the lock acquisition rules out lock-order deadlocks.
 *
 * Does NOT bump the version — the caller's version-guarded write both
 * authenticates the change and rolls this back if the version is stale.
 */
export async function applyDependencyChange(
  tx: Prisma.TransactionClient,
  before: Pick<DbTodo, "id" | "status">,
  requestedIds: readonly string[],
  actor: Actor
) {
  const id = before.id;
  const dependencyIds = [...new Set(requestedIds)];

  if (dependencyIds.includes(id)) {
    throw new AppError(400, ErrorCodes.DEPENDENCY_CYCLE, "A TODO cannot depend on itself", {
      path: [id, id],
    });
  }

  // A11: the graph is decided before work starts
  if (before.status !== "not_started") {
    throw new AppError(
      409,
      ErrorCodes.DEPENDENCY_EDIT_INVALID_STATUS,
      "Dependencies can only be edited while the task is Not Started — move it back first",
      { status: before.status }
    );
  }

  const involved = [id, ...dependencyIds].sort();
  const rows = await tx.$queryRaw<LockedRow[]>`
    SELECT id, name, status, deleted_at AS "deletedAt"
    FROM todos
    WHERE id IN (${Prisma.join(involved)})
    ORDER BY id
    FOR SHARE`;
  const byId = new Map(rows.map((r) => [r.id, r]));

  const invalid = dependencyIds.filter((d) => {
    const row = byId.get(d);
    return !row || row.deletedAt;
  });
  if (invalid.length > 0) {
    throw new AppError(400, ErrorCodes.VALIDATION, "Some dependencies do not exist", {
      invalidDependencyIds: invalid,
    });
  }

  const edges = await tx.todoDependency.findMany({
    select: { dependentId: true, dependencyId: true },
  });
  const cyclePath = findCycle(edges, id, dependencyIds);
  if (cyclePath) {
    const names = await tx.todo.findMany({
      where: { id: { in: cyclePath } },
      select: { id: true, name: true },
    });
    throw new AppError(400, ErrorCodes.DEPENDENCY_CYCLE, "This would create a dependency cycle", {
      path: cyclePath,
      names: Object.fromEntries(names.map((n) => [n.id, n.name])),
    });
  }

  const oldIds = edges.filter((e) => e.dependentId === id).map((e) => e.dependencyId);
  await tx.todoDependency.deleteMany({ where: { dependentId: id } });
  if (dependencyIds.length > 0) {
    await tx.todoDependency.createMany({
      data: dependencyIds.map((dependencyId) => ({ dependentId: id, dependencyId })),
    });
  }

  const added = dependencyIds.filter((d) => !oldIds.includes(d));
  const removed = oldIds.filter((d) => !dependencyIds.includes(d));
  if (added.length > 0 || removed.length > 0) {
    const removedNames = await tx.todo.findMany({
      where: { id: { in: removed } },
      select: { id: true, name: true },
    });
    await logActivity(
      tx,
      id,
      "dependencies_changed",
      {
        added: added.map((d) => ({ id: d, name: byId.get(d)!.name })),
        removed: removedNames,
      },
      actor
    );
  }
}

/** Standalone endpoint form: PUT /todos/:id/dependencies. */
export async function setDependencies(id: string, input: SetDependencies, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.todo.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundError();

    await applyDependencyChange(tx, before, input.dependencyIds, actor);

    // A dependency change IS an edit: version-guarded like every write (D4).
    // Zero rows matched → stale → the transaction (edges included) rolls back.
    const { count } = await tx.todo.updateMany({
      where: { id, version: input.version, deletedAt: null },
      data: { version: { increment: 1 } },
    });
    if (count === 0) {
      throw new AppError(409, ErrorCodes.STALE_VERSION, "TODO was modified by someone else", {
        current: null,
      });
    }

    return getTodoDetail(id, tx);
  });
}
