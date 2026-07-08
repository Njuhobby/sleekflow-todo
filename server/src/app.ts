import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
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

export function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
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
  app.setErrorHandler((err, _req, reply) => {
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
    app.log.error(err);
    return reply.status(500).send({
      error: { code: ErrorCodes.INTERNAL, message: "Internal server error", details: null },
    });
  });

  app.register(healthRoutes, { prefix: "/api" });

  return app;
}
