import type { Prisma } from "@prisma/client";

export type ActivityType =
  | "created"
  | "updated"
  | "status_changed"
  | "dependencies_changed"
  | "deleted"
  | "restored"
  | "spawned_next"
  | "created_from_recurrence";

/**
 * Append one event to the activity trail (R-7.1). MUST be called with the
 * transaction client of the mutation it describes — atomicity is what
 * guarantees the log can neither miss a change nor record a rolled-back one.
 */
export async function logActivity(
  tx: Prisma.TransactionClient,
  todoId: string,
  type: ActivityType,
  payload: unknown
) {
  await tx.activity.create({
    data: { todoId, type, payload: payload as Prisma.InputJsonValue },
  });
}
