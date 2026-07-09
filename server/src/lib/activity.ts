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

/** Who performed a mutation (R-7.5) — from the verified session token. */
export interface Actor {
  id: string;
  name: string;
}

/**
 * Append one event to the activity trail (R-7.1). MUST be called with the
 * transaction client of the mutation it describes — atomicity is what
 * guarantees the log can neither miss a change nor record a rolled-back one.
 * The actor's name is snapshotted (R-7.3): history stays honest even if the
 * account is later renamed.
 */
export async function logActivity(
  tx: Prisma.TransactionClient,
  todoId: string,
  type: ActivityType,
  payload: unknown,
  actor?: Actor | null
) {
  await tx.activity.create({
    data: {
      todoId,
      type,
      payload: payload as Prisma.InputJsonValue,
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? null,
    },
  });
}
