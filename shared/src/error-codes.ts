/**
 * Error-code catalog — the single source of truth for API error identification.
 * The server throws them; the web client switches on them. (R-6.4)
 */
export const ErrorCodes = {
  VALIDATION: "VALIDATION",
  NOT_FOUND: "NOT_FOUND",
  STALE_VERSION: "STALE_VERSION",
  TODO_BLOCKED: "TODO_BLOCKED",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  DEPENDENCY_CYCLE: "DEPENDENCY_CYCLE",
  DEPENDENCY_EDIT_INVALID_STATUS: "DEPENDENCY_EDIT_INVALID_STATUS",
  DEPENDENT_IN_PROGRESS: "DEPENDENT_IN_PROGRESS",
  NOT_DELETED: "NOT_DELETED",
  UNAUTHORIZED: "UNAUTHORIZED",
  EMAIL_TAKEN: "EMAIL_TAKEN",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
