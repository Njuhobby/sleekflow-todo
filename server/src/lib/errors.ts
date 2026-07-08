import type { ErrorCode } from "@shared/error-codes";
import { ErrorCodes } from "@shared/error-codes";

/**
 * Domain errors carry an HTTP status and a catalog code (R-6.4).
 * The global error handler in app.ts is the only place that turns
 * them into HTTP responses.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "TODO not found") {
    super(404, ErrorCodes.NOT_FOUND, message);
  }
}
