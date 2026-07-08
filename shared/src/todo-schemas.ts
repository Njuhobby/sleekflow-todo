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
  })
  .strict();
export type UpdateTodo = z.infer<typeof UpdateTodoSchema>;

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

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().nullable(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
