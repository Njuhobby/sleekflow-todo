import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { LoginSchema, RegisterSchema, UserSchema } from "@shared/auth-schemas";
import { ErrorEnvelopeSchema } from "@shared/todo-schemas";
import { ErrorCodes } from "@shared/error-codes";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";

const COOKIE = {
  path: "/",
  httpOnly: true, // JS can't read it — XSS can't steal the session
  sameSite: "lax" as const, // cross-site POSTs don't carry it — CSRF baseline
  maxAge: 7 * 24 * 3600,
};

function setSession(
  reply: FastifyReply,
  user: { id: string; name: string; email: string }
) {
  const token = reply.server.jwt.sign(
    { id: user.id, name: user.name, email: user.email },
    { expiresIn: "7d" }
  );
  reply.setCookie("token", token, COOKIE);
}

export async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: "POST",
    url: "/auth/register",
    schema: {
      body: RegisterSchema,
      response: { 201: UserSchema, 400: ErrorEnvelopeSchema, 409: ErrorEnvelopeSchema },
    },
    handler: async (req, reply) => {
      const existing = await prisma.user.findUnique({ where: { email: req.body.email } });
      if (existing) {
        throw new AppError(409, ErrorCodes.EMAIL_TAKEN, "That email is already registered");
      }
      const user = await prisma.user.create({
        data: {
          email: req.body.email,
          name: req.body.name,
          passwordHash: await bcrypt.hash(req.body.password, 10),
        },
      });
      setSession(reply, user);
      return reply
        .status(201)
        .send({ id: user.id, email: user.email, name: user.name });
    },
  });

  r.route({
    method: "POST",
    url: "/auth/login",
    schema: {
      body: LoginSchema,
      response: { 200: UserSchema, 400: ErrorEnvelopeSchema, 401: ErrorEnvelopeSchema },
    },
    handler: async (req, reply) => {
      const user = await prisma.user.findUnique({ where: { email: req.body.email } });
      // Same error either way — don't reveal which emails exist
      if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
        throw new AppError(401, ErrorCodes.INVALID_CREDENTIALS, "Wrong email or password");
      }
      setSession(reply, user);
      return { id: user.id, email: user.email, name: user.name };
    },
  });

  r.route({
    method: "POST",
    url: "/auth/logout",
    schema: { response: { 204: z.null() } },
    handler: async (_req, reply) => {
      reply.clearCookie("token", { path: "/" });
      return reply.status(204).send(null);
    },
  });

  r.route({
    method: "GET",
    url: "/auth/me",
    schema: { response: { 200: UserSchema, 401: ErrorEnvelopeSchema } },
    preHandler: (req) => app.authenticate(req),
    handler: async (req) => ({
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
    }),
  });
}
