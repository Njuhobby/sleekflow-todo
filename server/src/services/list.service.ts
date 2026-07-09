import type { Prisma } from "@prisma/client";
import type { ListTodosQuery, TodoList } from "@shared/todo-schemas";
import { prisma } from "../lib/prisma.js";
import { toTodoDto } from "../lib/serialize.js";

/**
 * Filtering, sorting, and pagination all execute in the database (A9) —
 * the client never receives more than one page. Query budget (D1): the
 * list, its batched relations, and the count — three queries per page,
 * independent of row count. Per-row lookups are forbidden.
 */
export async function listTodos(query: ListTodosQuery): Promise<TodoList> {
  const where: Prisma.TodoWhereInput = {
    deletedAt: query.deleted ? { not: null } : null,
    ...(query.status && { status: { in: query.status } }),
    ...(query.priority && { priority: { in: query.priority } }),
    ...((query.dueBefore || query.dueAfter) && {
      dueDate: {
        ...(query.dueBefore && { lte: new Date(query.dueBefore) }),
        ...(query.dueAfter && { gte: new Date(query.dueAfter) }),
      },
    }),
    ...((query.createdBefore || query.createdAfter) && {
      createdAt: {
        ...(query.createdBefore && { lte: new Date(query.createdBefore) }),
        ...(query.createdAfter && { gte: new Date(query.createdAfter) }),
      },
    }),
    ...(query.q && { name: { contains: query.q, mode: "insensitive" } }),
    // Compiles to EXISTS / NOT EXISTS on the edges (D1). Edges only ever
    // reference live todos (R-1.4), so no deletedAt filter is needed here.
    ...(query.blocked === true && {
      dependencies: { some: { dependency: { status: { not: "completed" } } } },
    }),
    ...(query.blocked === false && {
      dependencies: { none: { dependency: { status: { not: "completed" } } } },
    }),
  };

  // Postgres sorts enum columns by declaration order, so priority and
  // status order correctly without mapping. Undated rows always sort last;
  // id breaks ties so pagination never shows a row twice.
  const direction = query.order;
  const orderBy: Prisma.TodoOrderByWithRelationInput[] = [
    query.sortBy === "dueDate"
      ? { dueDate: { sort: direction, nulls: "last" } }
      : { [query.sortBy]: direction },
    { id: "asc" },
  ];

  const [rows, total] = await Promise.all([
    prisma.todo.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        dependencies: {
          where: { dependency: { status: { not: "completed" } } },
          include: { dependency: { select: { id: true, name: true, status: true } } },
        },
      },
    }),
    prisma.todo.count({ where }),
  ]);

  return {
    items: rows.map((row) => {
      const incompleteDependencies = row.dependencies.map((e) => e.dependency);
      return {
        ...toTodoDto(row),
        isBlocked: incompleteDependencies.length > 0,
        incompleteDependencies,
      };
    }),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
