import { Prisma } from "@prisma/client";
import type { Todo as DbTodo } from "@prisma/client";
import type { CreateTodo, UpdateTodo } from "@shared/todo-schemas";
import { ErrorCodes } from "@shared/error-codes";
import { prisma } from "../lib/prisma.js";
import { AppError, NotFoundError } from "../lib/errors.js";
import { logActivity } from "../lib/activity.js";
import { toTodoDto, toTodoDetailDto } from "../lib/serialize.js";
import { isLegalTransition, legalTargets, requiresUnblocked } from "../domain/transitions.js";
import { nextDueDate } from "../domain/recurrence.js";
import type { Recurrence } from "@shared/todo-schemas";

const RELATION_INCLUDE = {
  dependencies: {
    include: { dependency: { select: { id: true, name: true, status: true } } },
  },
  dependents: {
    include: { dependent: { select: { id: true, name: true, status: true } } },
  },
} as const;

/**
 * The single guarded write path (D2): every mutation goes through this
 * service inside a transaction, and every mutation appends its activity
 * event in that same transaction (D7). Routes stay HTTP-only.
 */

function recurrenceInput(recurrence: CreateTodo["recurrence"]) {
  return recurrence === null ? Prisma.DbNull : recurrence;
}

/** updateMany matched nothing — figure out whether that's 404 or 409 (D4). */
async function throwStaleOrNotFound(
  tx: Prisma.TransactionClient,
  id: string
): Promise<never> {
  const current = await tx.todo.findUnique({ where: { id } });
  if (!current || current.deletedAt) throw new NotFoundError();
  throw new AppError(409, ErrorCodes.STALE_VERSION, "TODO was modified by someone else", {
    current: toTodoDto(current),
  });
}

export async function createTodo(input: CreateTodo) {
  return prisma.$transaction(async (tx) => {
    const todo = await tx.todo.create({
      data: {
        name: input.name,
        description: input.description,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        priority: input.priority,
        recurrence: recurrenceInput(input.recurrence),
      },
    });
    await logActivity(tx, todo.id, "created", {
      name: todo.name,
      priority: todo.priority,
      dueDate: todo.dueDate?.toISOString() ?? null,
      recurrence: todo.recurrence ?? null,
    });
    return toTodoDto(todo);
  });
}

export async function getTodoDetail(id: string, client: Prisma.TransactionClient = prisma) {
  const todo = await client.todo.findUnique({ where: { id }, include: RELATION_INCLUDE });
  if (!todo || todo.deletedAt) throw new NotFoundError();
  return toTodoDetailDto(todo);
}

export async function updateTodo(id: string, input: UpdateTodo) {
  const { version, status: nextStatus, ...changes } = input;

  return prisma.$transaction(async (tx) => {
    const before = await tx.todo.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundError();

    const statusChanging = nextStatus !== undefined && nextStatus !== before.status;
    if (statusChanging) {
      if (!isLegalTransition(before.status, nextStatus)) {
        throw new AppError(
          400,
          ErrorCodes.INVALID_TRANSITION,
          `Cannot move a TODO from ${before.status} to ${nextStatus}`,
          { from: before.status, to: nextStatus, legalTargets: legalTargets(before.status) }
        );
      }
      if (requiresUnblocked(nextStatus)) await assertUnblocked(tx, id);
    }

    const { count } = await tx.todo.updateMany({
      where: { id, version, deletedAt: null },
      data: {
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.description !== undefined && { description: changes.description }),
        ...(changes.dueDate !== undefined && {
          dueDate: changes.dueDate ? new Date(changes.dueDate) : null,
        }),
        ...(changes.priority !== undefined && { priority: changes.priority }),
        ...(changes.recurrence !== undefined && {
          recurrence: recurrenceInput(changes.recurrence),
        }),
        ...(statusChanging && { status: nextStatus }),
        version: { increment: 1 },
      },
    });
    if (count === 0) await throwStaleOrNotFound(tx, id);

    const after = (await tx.todo.findUnique({ where: { id } })) as DbTodo;
    if (statusChanging) {
      await logActivity(tx, id, "status_changed", { from: before.status, to: nextStatus });
    }
    const changed = diff(before, after);
    if (Object.keys(changed).length > 0) {
      await logActivity(tx, id, "updated", { changed });
    }

    // D3: completing a recurring todo spawns the next occurrence in this
    // same transaction. Idempotency needs no extra machinery — the version
    // guard above means a duplicate completion matches zero rows and 409s
    // before ever reaching this point.
    if (statusChanging && nextStatus === "completed" && after.recurrence) {
      await spawnNextOccurrence(tx, after);
    }

    return getTodoDetail(id, tx);
  });
}

/** Create the next occurrence of a recurring todo (R-2.2, R-2.6). */
async function spawnNextOccurrence(tx: Prisma.TransactionClient, completed: DbTodo) {
  const recurrence = completed.recurrence as Recurrence;
  const due = nextDueDate(recurrence, completed.dueDate, new Date());

  // Same name/description/priority/recurrence; not_started; NO dependency
  // links (A7) — dependencies describe one-time ordering.
  const spawned = await tx.todo.create({
    data: {
      name: completed.name,
      description: completed.description,
      priority: completed.priority,
      recurrence,
      dueDate: due,
    },
  });

  await logActivity(tx, completed.id, "spawned_next", {
    nextId: spawned.id,
    nextDue: due?.toISOString() ?? null,
  });
  await logActivity(tx, spawned.id, "created_from_recurrence", {
    sourceId: completed.id,
    name: spawned.name,
  });
}

/**
 * The blocked guard (R-3.4, D2). Locks the dependency rows FOR SHARE so a
 * concurrent reopen of a dependency cannot slip past the check: the reopen
 * waits until this transition commits (or vice versa). Ordered by id to keep
 * lock acquisition deadlock-free.
 */
async function assertUnblocked(tx: Prisma.TransactionClient, id: string) {
  const deps = await tx.$queryRaw<Array<{ id: string; name: string; status: string }>>`
    SELECT t.id, t.name, t.status
    FROM todos t
    WHERE t.id IN (SELECT dependency_id FROM todo_dependencies WHERE dependent_id = ${id})
    ORDER BY t.id
    FOR SHARE`;
  const incomplete = deps.filter((d) => d.status !== "completed");
  if (incomplete.length > 0) {
    throw new AppError(409, ErrorCodes.TODO_BLOCKED, "TODO is blocked by incomplete dependencies", {
      incompleteDependencies: incomplete,
    });
  }
}

export async function deleteTodo(id: string) {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.todo.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (count === 0) throw new NotFoundError();

    // R-1.4: severing the edges here (not filtering them at read time) is what
    // keeps the dependency graph free of deleted-node special cases (D5) and
    // makes restore incapable of reviving a cycle.
    const edges = await tx.todoDependency.findMany({
      where: { OR: [{ dependentId: id }, { dependencyId: id }] },
      include: {
        dependent: { select: { id: true, name: true } },
        dependency: { select: { id: true, name: true } },
      },
    });
    await tx.todoDependency.deleteMany({
      where: { OR: [{ dependentId: id }, { dependencyId: id }] },
    });

    await logActivity(tx, id, "deleted", {
      severedLinks: edges.map((e) =>
        e.dependentId === id
          ? { direction: "depends_on" as const, ...e.dependency }
          : { direction: "blocks" as const, ...e.dependent }
      ),
    });
  });
}

export async function restoreTodo(id: string) {
  return prisma.$transaction(async (tx) => {
    const todo = await tx.todo.findUnique({ where: { id } });
    if (!todo) throw new NotFoundError();
    if (!todo.deletedAt) {
      throw new AppError(409, ErrorCodes.NOT_DELETED, "TODO is not deleted");
    }

    // R-1.5: comes back WITHOUT dependency links (they were severed on delete)
    const restored = await tx.todo.update({
      where: { id },
      data: { deletedAt: null, version: { increment: 1 } },
    });
    await logActivity(tx, id, "restored", { status: restored.status });
    return toTodoDto(restored);
  });
}

/**
 * A todo's event history, newest first (R-7.4). Works for soft-deleted
 * todos too — the trail IS the record of what happened to them.
 */
export async function listActivities(id: string, page: number, pageSize: number) {
  const exists = await prisma.todo.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new NotFoundError();

  const [items, total] = await Promise.all([
    prisma.activity.findMany({
      where: { todoId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.activity.count({ where: { todoId: id } }),
  ]);

  return {
    items: items.map((a) => ({
      id: a.id,
      todoId: a.todoId,
      type: a.type,
      payload: a.payload,
      createdAt: a.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
  };
}

/** Field-level old → new diff for the `updated` activity payload. */
function diff(before: DbTodo, after: DbTodo) {
  const changed: Record<string, [unknown, unknown]> = {};
  const fields = ["name", "description", "dueDate", "priority", "recurrence"] as const;
  for (const f of fields) {
    const b = before[f] instanceof Date ? (before[f] as Date).toISOString() : before[f];
    const a = after[f] instanceof Date ? (after[f] as Date).toISOString() : after[f];
    if (JSON.stringify(b) !== JSON.stringify(a)) changed[f] = [b ?? null, a ?? null];
  }
  return changed;
}
