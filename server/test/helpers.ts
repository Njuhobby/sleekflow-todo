import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

export async function createTestApp(): Promise<FastifyInstance> {
  const app = buildApp();
  await app.ready();
  return app;
}

/** Wipe all tables between tests — files run sequentially (vitest.config). */
export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "activities", "todo_dependencies", "todos" CASCADE'
  );
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
  const res = await app.inject({
    method: "POST",
    url: "/api/todos",
    payload: { name: "task", ...overrides },
  });
  if (res.statusCode !== 201) {
    throw new Error(`makeTodo failed: ${res.statusCode} ${res.body}`);
  }
  return json(res);
}
