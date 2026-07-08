import type { Status } from "./todo-schemas.js";

/**
 * Display principle 1: a finished or shelved task is never "overdue" —
 * its due date is history, not a call to action.
 */
export function isOverdue(
  todo: { dueDate: string | null; status: Status },
  now: Date = new Date()
): boolean {
  if (!todo.dueDate) return false;
  if (todo.status === "completed" || todo.status === "archived") return false;
  return new Date(todo.dueDate) < now;
}
