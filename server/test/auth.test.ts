import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, json, makeTodo, resetDb } from "./helpers.js";

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  app ??= await createTestApp();
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

const CREDS = { email: "alice@example.com", name: "Alice", password: "password123" };

async function register(payload: Record<string, unknown> = CREDS) {
  return app.inject({ method: "POST", url: "/api/auth/register", payload });
}

describe("auth (T-7.1)", () => {
  it("register sets an httpOnly session cookie and returns the user", async () => {
    const res = await register();
    expect(res.statusCode).toBe(201);
    expect(json(res)).toMatchObject({ email: "alice@example.com", name: "Alice" });

    const cookie = res.cookies.find((c) => c.name === "token")!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
  });

  it("duplicate email → 409 EMAIL_TAKEN", async () => {
    await register();
    const res = await register();
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe("EMAIL_TAKEN");
  });

  it.each([
    ["bad email", { ...CREDS, email: "not-an-email" }],
    ["short password", { ...CREDS, password: "1234567" }],
    ["empty name", { ...CREDS, name: "" }],
  ])("register rejects %s", async (_label, payload) => {
    const res = await register(payload);
    expect(res.statusCode).toBe(400);
  });

  it("login works with the right password, 401 otherwise — same error for unknown email", async () => {
    await register();

    const ok = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: CREDS.email, password: CREDS.password },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.cookies.find((c) => c.name === "token")).toBeTruthy();

    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: CREDS.email, password: "wrong-password" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(json(wrong).error.code).toBe("INVALID_CREDENTIALS");

    const unknown = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nobody@example.com", password: "whatever1" },
    });
    expect(unknown.statusCode).toBe(401);
    expect(json(unknown).error.code).toBe("INVALID_CREDENTIALS"); // no email enumeration
  });

  it("me returns the session user; logout clears the cookie", async () => {
    const reg = await register();
    const token = reg.cookies.find((c) => c.name === "token")!.value;

    const me = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { token } });
    expect(me.statusCode).toBe(200);
    expect(json(me).email).toBe("alice@example.com");

    const out = await app.inject({ method: "POST", url: "/api/auth/logout" });
    expect(out.statusCode).toBe(204);
    const cleared = out.cookies.find((c) => c.name === "token")!;
    expect(cleared.value).toBe("");
  });

  it("the whole todo surface is behind the login (T-7.1 forced auth)", async () => {
    for (const [method, url] of [
      ["GET", "/api/todos"],
      ["POST", "/api/todos"],
      ["GET", "/api/todos/calendar?from=2026-07-01T00:00:00Z&to=2026-07-02T00:00:00Z"],
    ] as const) {
      const res = await app.inject({ method, url, payload: undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(json(res).error.code).toBe("UNAUTHORIZED");
    }
    // health stays public
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
  });

  it("mutations record the actor, snapshotted by name (R-7.5)", async () => {
    const todo = await makeTodo(app); // helper session = "Tester"
    const activity = await prisma.activity.findFirst({
      where: { todoId: todo.id, type: "created" },
    });
    expect(activity?.actorName).toBe("Tester");
    expect(activity?.actorId).toBeTruthy();
  });
});
