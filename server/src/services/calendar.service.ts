import { Prisma } from "@prisma/client";
import type { Calendar, CalendarDay, CalendarQuery } from "@shared/todo-schemas";
import { prisma } from "../lib/prisma.js";

interface Row {
  day: Date;
  id: string;
  name: string;
  status: CalendarDay["items"][number]["status"];
  priority: CalendarDay["items"][number]["priority"];
  isRecurring: boolean;
  total: bigint;
  incomplete: bigint;
}

/**
 * Per-day digests for the calendar (DL-13). One SQL query does the whole
 * job — group by day, rank within each day, keep the top 3, count totals —
 * so the payload is ~31 rows no matter how many todos exist (A9).
 *
 * Ranking: incomplete before completed/archived, then priority high → low
 * (Postgres sorts the enum by declaration order), id as a stable tiebreak.
 */
export async function getCalendar(query: CalendarQuery): Promise<Calendar> {
  const conditions = [
    Prisma.sql`deleted_at IS NULL`,
    Prisma.sql`due_date IS NOT NULL`,
    Prisma.sql`due_date >= ${new Date(query.from)}`,
    Prisma.sql`due_date <= ${new Date(query.to)}`,
  ];
  if (query.status) {
    conditions.push(Prisma.sql`status::text IN (${Prisma.join(query.status)})`);
  }
  if (query.priority) {
    conditions.push(Prisma.sql`priority::text IN (${Prisma.join(query.priority)})`);
  }
  if (query.q) {
    conditions.push(Prisma.sql`name ILIKE ${"%" + query.q + "%"}`);
  }
  const where = Prisma.join(conditions, " AND ");

  const rows = await prisma.$queryRaw<Row[]>`
    WITH scoped AS (
      SELECT id, name, status, priority,
             (recurrence IS NOT NULL) AS "isRecurring",
             due_date::date AS day
      FROM todos
      WHERE ${where}
    ),
    ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY day
          ORDER BY (status IN ('completed', 'archived')), priority DESC, id
        ) AS rn,
        COUNT(*) OVER (PARTITION BY day) AS total,
        COUNT(*) FILTER (WHERE status NOT IN ('completed', 'archived'))
          OVER (PARTITION BY day) AS incomplete
      FROM scoped
    )
    SELECT day, id, name, status, priority, "isRecurring", total, incomplete
    FROM ranked
    WHERE rn <= 3
    ORDER BY day, rn`;

  const byDay = new Map<string, CalendarDay>();
  for (const row of rows) {
    const date = row.day.toISOString().slice(0, 10);
    let day = byDay.get(date);
    if (!day) {
      day = { date, total: Number(row.total), incomplete: Number(row.incomplete), items: [] };
      byDay.set(date, day);
    }
    day.items.push({
      id: row.id,
      name: row.name,
      status: row.status,
      priority: row.priority,
      isRecurring: row.isRecurring,
    });
  }

  return { days: [...byDay.values()] };
}
