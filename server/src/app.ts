import Fastify from "fastify";
import type { FastifyError } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fastifyStatic from "@fastify/static";
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  hasZodFastifySchemaValidationErrors,
} from "fastify-type-provider-zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ErrorCodes } from "@shared/error-codes";
import { AppError } from "./lib/errors.js";
import { healthRoutes } from "./routes/health.routes.js";
import { todosRoutes } from "./routes/todos.routes.js";

export function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    // Two JSON lines per request drowns real signal — the query-invalidation
    // refetches alone make the terminal unreadable. Errors still log via the
    // error handler; re-enable per-request logs when actually tracing traffic.
    disableRequestLogging: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(swagger, {
    openapi: {
      info: {
        title: "SleekFlow TODO API",
        description: "TODO list with recurring tasks, dependencies, and an activity trail",
        version: "0.1.0",
      },
    },
    transform: jsonSchemaTransform,
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  // Single place that shapes every error into the envelope (R-6.4):
  // { error: { code, message, details } }
  app.setErrorHandler((err: FastifyError | AppError, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details ?? null },
      });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: {
          code: ErrorCodes.VALIDATION,
          message: "Request validation failed",
          details: err.validation,
        },
      });
    }
    // Opposite-order lock crossfire (dependent starting ∥ dependency
    // reopening) is resolved by Postgres deadlock detection — surface the
    // aborted side as a retryable conflict, not a 500.
    if (err.message?.includes("deadlock detected")) {
      return reply.status(409).send({
        error: {
          code: ErrorCodes.STALE_VERSION,
          message: "Concurrent modification — please retry",
          details: null,
        },
      });
    }
    // Fastify's own client errors (malformed JSON, empty typed body, …)
    // carry a 4xx statusCode — surface them as validation, not 500s.
    if (typeof err.statusCode === "number" && err.statusCode < 500) {
      return reply.status(err.statusCode).send({
        error: { code: ErrorCodes.VALIDATION, message: err.message, details: null },
      });
    }
    app.log.error(err);
    return reply.status(500).send({
      error: { code: ErrorCodes.INTERNAL, message: "Internal server error", details: null },
    });
  });

  app.register(healthRoutes, { prefix: "/api" });
  app.register(todosRoutes, { prefix: "/api" });

  // Production single-image mode: serve the built SPA next to the API
  // (dev uses Vite's proxy instead — no CORS in either environment).
  const webDist = process.env.WEB_DIST;
  if (webDist) {
    app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api")) {
        return reply.sendFile("index.html"); // SPA fallback for /trash etc.
      }
      return reply.status(404).send({
        error: { code: ErrorCodes.NOT_FOUND, message: "Route not found", details: null },
      });
    });
  }

  return app;
}
