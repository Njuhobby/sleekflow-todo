import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

export async function healthRoutes(app: FastifyInstance) {
  app.route({
    method: "GET",
    url: "/health",
    schema: {
      response: {
        200: z.object({ status: z.literal("ok"), db: z.boolean() }),
      },
    },
    handler: async () => {
      let db = false;
      try {
        await prisma.$queryRaw`SELECT 1`;
        db = true;
      } catch {
        db = false;
      }
      return { status: "ok" as const, db };
    },
  });
}
