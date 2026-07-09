import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateTodoSchema,
  UpdateTodoSchema,
  SetDependenciesSchema,
  IdParamSchema,
  TodoSchema,
  TodoDetailSchema,
  ActivityListQuerySchema,
  ActivityListSchema,
  ListTodosQuerySchema,
  TodoListSchema,
  CalendarQuerySchema,
  CalendarSchema,
  ErrorEnvelopeSchema,
} from "@shared/todo-schemas";
import * as todoService from "../services/todo.service.js";
import { setDependencies } from "../services/dependency.service.js";
import { listTodos } from "../services/list.service.js";
import { getCalendar } from "../services/calendar.service.js";

// Routes are thin: parse (Zod, from shared schemas) → service → DTO out.
// The whole todo surface requires a session (T-7.1: forced login); the
// authenticated user becomes the actor on every activity event (R-7.5).
export async function todosRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  // onRequest, not preHandler: authentication must precede body validation —
  // an anonymous caller gets 401, never a validation error for a request we
  // were never going to process.
  r.addHook("onRequest", (req) => app.authenticate(req));

  r.route({
    method: "GET",
    url: "/todos",
    schema: {
      querystring: ListTodosQuerySchema,
      response: { 200: TodoListSchema, 400: ErrorEnvelopeSchema },
    },
    handler: (req) => listTodos(req.query),
  });

  r.route({
    method: "GET",
    url: "/todos/calendar",
    schema: {
      querystring: CalendarQuerySchema,
      response: { 200: CalendarSchema, 400: ErrorEnvelopeSchema },
    },
    handler: (req) => getCalendar(req.query),
  });

  r.route({
    method: "POST",
    url: "/todos",
    schema: {
      body: CreateTodoSchema,
      response: { 201: TodoSchema, 400: ErrorEnvelopeSchema },
    },
    handler: async (req, reply) => {
      const todo = await todoService.createTodo(req.body, req.user);
      return reply.status(201).send(todo);
    },
  });

  r.route({
    method: "GET",
    url: "/todos/:id",
    schema: {
      params: IdParamSchema,
      response: { 200: TodoDetailSchema, 404: ErrorEnvelopeSchema },
    },
    handler: (req) => todoService.getTodoDetail(req.params.id),
  });

  r.route({
    method: "PATCH",
    url: "/todos/:id",
    schema: {
      params: IdParamSchema,
      body: UpdateTodoSchema,
      response: {
        200: TodoDetailSchema,
        400: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
        409: ErrorEnvelopeSchema,
      },
    },
    handler: (req) => todoService.updateTodo(req.params.id, req.body, req.user),
  });

  r.route({
    method: "PUT",
    url: "/todos/:id/dependencies",
    schema: {
      body: SetDependenciesSchema,
      params: IdParamSchema,
      response: {
        200: TodoDetailSchema,
        400: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
        409: ErrorEnvelopeSchema,
      },
    },
    handler: (req) => setDependencies(req.params.id, req.body, req.user),
  });

  r.route({
    method: "DELETE",
    url: "/todos/:id",
    schema: {
      params: IdParamSchema,
      response: { 204: z.null(), 404: ErrorEnvelopeSchema },
    },
    handler: async (req, reply) => {
      await todoService.deleteTodo(req.params.id, req.user);
      return reply.status(204).send(null);
    },
  });

  r.route({
    method: "GET",
    url: "/todos/:id/activities",
    schema: {
      params: IdParamSchema,
      querystring: ActivityListQuerySchema,
      response: { 200: ActivityListSchema, 404: ErrorEnvelopeSchema },
    },
    handler: (req) =>
      todoService.listActivities(req.params.id, req.query.page, req.query.pageSize),
  });

  r.route({
    method: "POST",
    url: "/todos/:id/restore",
    schema: {
      params: IdParamSchema,
      response: { 200: TodoSchema, 404: ErrorEnvelopeSchema, 409: ErrorEnvelopeSchema },
    },
    handler: (req) => todoService.restoreTodo(req.params.id, req.user),
  });
}
