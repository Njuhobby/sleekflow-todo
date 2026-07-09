import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

let authCookie: string | undefined;

export async function createTestApp(): Promise<FastifyInstance> {
  const app = buildApp();
  await app.ready();
  // One session for the whole run: the JWT is stateless (verified by
  // signature, not by a users-table lookup), so it survives resetDb()
  // truncations between tests.
  if (!authCookie) {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: `tester-${Date.now()}@example.com`,
        name: "Tester",
        password: "password123",
      },
    });
    if (res.statusCode !== 201) throw new Error(`test auth setup failed: ${res.body}`);
    authCookie = res.cookies.find((c) => c.name === "token")!.value;
  }
  return app;
}

/** app.inject with the shared test session attached (T-7.1: forced login). */
export function inject(app: FastifyInstance, opts: InjectOptions) {
  return app.inject({
    ...opts,
    cookies: { token: authCookie!, ...(opts.cookies as Record<string, string> | undefined) },
  });
}

/** Wipe all tables between tests — files run sequentially (vitest.config). */
export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "activities", "todo_dependencies", "todos", "users" CASCADE'
  );
  // The shared session survives this: the JWT is verified by signature, not
  // by a users-table lookup.
}

type InjectResponse = Awaited<ReturnType<FastifyInstance["inject"]>>;

export function json(res: InjectResponse) {
  return res.body ? JSON.parse(res.body) : null;
}

/** Shorthand: create a todo through the API and return its body. */
export async function makeTodo(
  app: FastifyInstance,
  overrides: Record<string, unknown> = {}
) {
  const res = await inject(app, {
    method: "POST",
    url: "/api/todos",
    payload: { name: "task", ...overrides },
  });
  if (res.statusCode !== 201) {
    throw new Error(`makeTodo failed: ${res.statusCode} ${res.body}`);
  }
  return json(res);
}
