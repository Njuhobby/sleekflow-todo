import type { ErrorCode } from "@shared/error-codes";

/** Typed API error carrying the envelope's code — UI switches on it. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    // Content-Type only when there IS content — Fastify rejects an empty
    // JSON body, so a bare DELETE must not claim to carry one.
    ...(init?.body ? { headers: { "Content-Type": "application/json" } } : {}),
    ...init,
  });
  if (res.status === 204) return null as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error ?? { code: "INTERNAL", message: `HTTP ${res.status}` };
    throw new ApiError(res.status, err.code, err.message, err.details ?? null);
  }
  return body as T;
}
