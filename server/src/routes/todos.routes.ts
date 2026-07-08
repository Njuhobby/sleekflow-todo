import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateTodoSchema,
  UpdateTodoSchema,
  IdParamSchema,
  TodoSchema,
  ErrorEnvelopeSchema,
} from "@shared/todo-schemas";
import * as todoService from "../services/todo.service.js";

// Routes are thin: parse (Zod, from shared schemas) → service → DTO out.
export async function todosRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: "POST",
    url: "/todos",
    schema: {
      body: CreateTodoSchema,
      response: { 201: TodoSchema, 400: ErrorEnvelopeSchema },
    },
    handler: async (req, reply) => {
      const todo = await todoService.createTodo(req.body);
      return reply.status(201).send(todo);
    },
  });

  r.route({
    method: "GET",
    url: "/todos/:id",
    schema: {
      params: IdParamSchema,
      response: { 200: TodoSchema, 404: ErrorEnvelopeSchema },
    },
    handler: (req) => todoService.getTodo(req.params.id),
  });

  r.route({
    method: "PATCH",
    url: "/todos/:id",
    schema: {
      params: IdParamSchema,
      body: UpdateTodoSchema,
      response: {
        200: TodoSchema,
        400: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
        409: ErrorEnvelopeSchema,
      },
    },
    handler: (req) => todoService.updateTodo(req.params.id, req.body),
  });

  r.route({
    method: "DELETE",
    url: "/todos/:id",
    schema: {
      params: IdParamSchema,
      response: { 204: z.null(), 404: ErrorEnvelopeSchema },
    },
    handler: async (req, reply) => {
      await todoService.deleteTodo(req.params.id);
      return reply.status(204).send(null);
    },
  });

  r.route({
    method: "POST",
    url: "/todos/:id/restore",
    schema: {
      params: IdParamSchema,
      response: { 200: TodoSchema, 404: ErrorEnvelopeSchema, 409: ErrorEnvelopeSchema },
    },
    handler: (req) => todoService.restoreTodo(req.params.id),
  });
}
