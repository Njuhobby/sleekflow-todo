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
    /**
     * Optional dependency replacement, applied in the SAME transaction as the
     * other changes — the panel's draft model saves everything atomically.
     * Applied before the status change (A11 checks the task's current status);
     * any failure rolls the whole save back.
     */
    dependencyIds: z.array(z.string().uuid()).max(100).optional(),
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

/** Accepts both repeated params (?status=a&status=b) and CSV (?status=a,b). */
const multi = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess(
    (v) =>
      v === undefined
        ? undefined
        : (Array.isArray(v) ? v : [v]).flatMap((s) => String(s).split(",")),
    z.array(item).min(1).optional()
  );

// z.coerce.boolean() would turn "false" into true — use an explicit enum.
const queryBool = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

export const SortFieldSchema = z.enum(["dueDate", "priority", "status", "name", "createdAt"]);
export type SortField = z.infer<typeof SortFieldSchema>;

export const ListTodosQuerySchema = z.object({
  status: multi(StatusSchema),
  priority: multi(PrioritySchema),
  dueBefore: DueDateSchema.optional(),
  dueAfter: DueDateSchema.optional(),
  createdBefore: DueDateSchema.optional(),
  createdAfter: DueDateSchema.optional(),
  /** blocked=true → only blocked; blocked=false → only unblocked (R-4.1) */
  blocked: queryBool,
  /** Case-insensitive name substring — also powers the dependency picker. */
  q: z.string().trim().min(1).max(255).optional(),
  /** deleted=true → the trash view (only soft-deleted todos). */
  deleted: queryBool,
  sortBy: SortFieldSchema.default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListTodosQuery = z.infer<typeof ListTodosQuerySchema>;

/** List rows carry what the table needs — incl. tooltip data (no N+1). */
export const TodoListItemSchema = TodoSchema.extend({
  isBlocked: z.boolean(),
  incompleteDependencies: z.array(RelatedTodoSchema),
});
export type TodoListItem = z.infer<typeof TodoListItemSchema>;

export const TodoListSchema = z.object({
  items: z.array(TodoListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type TodoList = z.infer<typeof TodoListSchema>;

/** Calendar aggregation (DL-13): per-day digests, never raw month dumps. */
export const CalendarQuerySchema = z.object({
  from: DueDateSchema,
  to: DueDateSchema,
  status: multi(StatusSchema),
  priority: multi(PrioritySchema),
  q: z.string().trim().min(1).max(255).optional(),
});
export type CalendarQuery = z.infer<typeof CalendarQuerySchema>;

export const CalendarItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: StatusSchema,
  priority: PrioritySchema,
  isRecurring: z.boolean(),
});
export type CalendarItem = z.infer<typeof CalendarItemSchema>;

export const CalendarDaySchema = z.object({
  /** YYYY-MM-DD (UTC day) */
  date: z.string(),
  total: z.number().int(),
  incomplete: z.number().int(),
  /** Top 3: incomplete before completed, then priority high → low */
  items: z.array(CalendarItemSchema),
});
export type CalendarDay = z.infer<typeof CalendarDaySchema>;

export const CalendarSchema = z.object({ days: z.array(CalendarDaySchema) });
export type Calendar = z.infer<typeof CalendarSchema>;

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
