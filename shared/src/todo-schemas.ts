import { z } from "zod";

/**
 * Single source of truth for TODO shapes (T-1.1):
 * the server validates requests and generates OpenAPI from these,
 * the web client validates forms and infers types from the same objects.
 */

export const StatusSchema = z.enum(["not_started", "in_progress", "completed", "archived"]);
export type Status = z.infer<typeof StatusSchema>;

export const PrioritySchema = z.enum(["low", "medium", "high"]);
export type Priority = z.infer<typeof PrioritySchema>;

// A1: interval-based recurrence — daily/weekly/monthly are interval=1 cases,
// "custom" is any larger interval. Full RRULE deliberately out of scope.
export const RecurrenceSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().min(1).max(999),
});
export type Recurrence = z.infer<typeof RecurrenceSchema>;

const NameSchema = z.string().trim().min(1).max(255);
const DueDateSchema = z.string().datetime({ offset: true });

// .strict() everywhere: unknown keys are validation errors, which is also what
// rejects `status` here — transitions go through the guarded PATCH path only
// once M2 wires the guard in (T-1.3).
export const CreateTodoSchema = z
  .object({
    name: NameSchema,
    description: z.string().max(10_000).optional(),
    dueDate: DueDateSchema.optional(),
    priority: PrioritySchema.default("medium"),
    recurrence: RecurrenceSchema.nullish(),
  })
  .strict();
export type CreateTodo = z.infer<typeof CreateTodoSchema>;

export const UpdateTodoSchema = z
  .object({
    /** Optimistic concurrency token (D4): the version the client read. */
    version: z.number().int().min(1),
    name: NameSchema.optional(),
    description: z.string().max(10_000).nullish(),
    dueDate: DueDateSchema.nullish(),
    priority: PrioritySchema.optional(),
    recurrence: RecurrenceSchema.nullish(),
    /** Status changes run the R-1.8 transition guard in the service layer. */
    status: StatusSchema.optional(),
  })
  .strict();
export type UpdateTodo = z.infer<typeof UpdateTodoSchema>;

export const SetDependenciesSchema = z
  .object({
    /** Optimistic concurrency token — a dependency change IS an edit (D4). */
    version: z.number().int().min(1),
    dependencyIds: z.array(z.string().uuid()).max(100),
  })
  .strict();
export type SetDependencies = z.infer<typeof SetDependenciesSchema>;

export const IdParamSchema = z.object({ id: z.string().uuid() });

export const TodoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  dueDate: z.string().nullable(),
  status: StatusSchema,
  priority: PrioritySchema,
  version: z.number().int(),
  recurrence: RecurrenceSchema.nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Todo = z.infer<typeof TodoSchema>;

/** Compact shape for dependency/dependent listings inside a todo detail. */
export const RelatedTodoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: StatusSchema,
});
export type RelatedTodo = z.infer<typeof RelatedTodoSchema>;

export const TodoDetailSchema = TodoSchema.extend({
  /** Derived, never stored (D1): true iff any dependency is not completed. */
  isBlocked: z.boolean(),
  dependencies: z.array(RelatedTodoSchema),
  dependents: z.array(RelatedTodoSchema),
});
export type TodoDetail = z.infer<typeof TodoDetailSchema>;

export const ActivitySchema = z.object({
  id: z.string().uuid(),
  todoId: z.string().uuid(),
  type: z.string(),
  payload: z.unknown(),
  createdAt: z.string(),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const ActivityListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const ActivityListSchema = z.object({
  items: z.array(ActivitySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type ActivityList = z.infer<typeof ActivityListSchema>;

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().nullable(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
