import { Prisma } from "@prisma/client";
import type { Todo as DbTodo } from "@prisma/client";
import type { CreateTodo, UpdateTodo } from "@shared/todo-schemas";
import { ErrorCodes } from "@shared/error-codes";
import { prisma } from "../lib/prisma.js";
import { AppError, NotFoundError } from "../lib/errors.js";
import { logActivity } from "../lib/activity.js";
import { toTodoDto } from "../lib/serialize.js";

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

export async function getTodo(id: string) {
  const todo = await prisma.todo.findUnique({ where: { id } });
  if (!todo || todo.deletedAt) throw new NotFoundError();
  return toTodoDto(todo);
}

export async function updateTodo(id: string, input: UpdateTodo) {
  const { version, ...changes } = input;

  return prisma.$transaction(async (tx) => {
    const before = await tx.todo.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundError();

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
        version: { increment: 1 },
      },
    });
    if (count === 0) await throwStaleOrNotFound(tx, id);

    const after = (await tx.todo.findUnique({ where: { id } })) as DbTodo;
    const changed = diff(before, after);
    if (Object.keys(changed).length > 0) {
      await logActivity(tx, id, "updated", { changed });
    }
    return toTodoDto(after);
  });
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
