import type { Prisma, Todo as DbTodo } from "@prisma/client";
import type { Recurrence, Todo, TodoDetail } from "@shared/todo-schemas";

export type DbTodoWithRelations = Prisma.TodoGetPayload<{
  include: {
    dependencies: {
      include: { dependency: { select: { id: true; name: true; status: true } } };
    };
    dependents: {
      include: { dependent: { select: { id: true; name: true; status: true } } };
    };
  };
}>;

/** Prisma rows carry Date objects; the API speaks ISO strings. */
export function toTodoDto(todo: DbTodo): Todo {
  return {
    id: todo.id,
    name: todo.name,
    description: todo.description,
    dueDate: todo.dueDate?.toISOString() ?? null,
    status: todo.status,
    priority: todo.priority,
    version: todo.version,
    recurrence: (todo.recurrence as Recurrence | null) ?? null,
    deletedAt: todo.deletedAt?.toISOString() ?? null,
    createdAt: todo.createdAt.toISOString(),
    updatedAt: todo.updatedAt.toISOString(),
  };
}

export function toTodoDetailDto(todo: DbTodoWithRelations): TodoDetail {
  const dependencies = todo.dependencies.map((e) => e.dependency);
  return {
    ...toTodoDto(todo),
    // Derived, never stored (D1)
    isBlocked: dependencies.some((d) => d.status !== "completed"),
    dependencies,
    dependents: todo.dependents.map((e) => e.dependent),
  };
}
