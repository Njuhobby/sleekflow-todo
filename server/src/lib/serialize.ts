import type { Todo as DbTodo } from "@prisma/client";
import type { Recurrence, Todo } from "@shared/todo-schemas";

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
