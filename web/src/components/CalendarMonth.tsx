import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { CalendarDay, CalendarItem } from "@shared/todo-schemas";
import { useCalendar } from "../api/hooks.js";
import { DEFAULT_STATUSES } from "./FilterBar.js";
import { StatusDot } from "./StatusDot.js";

/**
 * Month grid fed by the per-day aggregation endpoint (DL-13): at most three
 * tasks per cell plus an overflow count — grouping/ranking happens in the
 * database, so the payload is ~31 rows regardless of list size (A9).
 * All day math is done on YYYY-MM-DD strings in UTC — no timezone objects.
 */
export function CalendarMonth({ onOpen }: { onOpen: (id: string) => void }) {
  const [params, setParams] = useSearchParams();

  const month = params.get("month") ?? new Date().toISOString().slice(0, 7); // YYYY-MM
  const [year, monthIndex] = [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1];
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay(); // 0 = Sunday
  const leadingBlanks = (firstWeekday + 6) % 7; // Monday-first grid

  const apiSearch = useMemo(() => {
    const api = new URLSearchParams();
    api.set("from", `${month}-01T00:00:00.000Z`);
    api.set("to", `${month}-${String(daysInMonth).padStart(2, "0")}T23:59:59.999Z`);
    api.set("status", params.get("status") ?? DEFAULT_STATUSES);
    for (const key of ["priority", "q"]) {
      const v = params.get(key);
      if (v) api.set(key, v);
    }
    return `?${api.toString()}`;
  }, [month, daysInMonth, params]);

  const { data } = useCalendar(apiSearch);
  const byDate = new Map<string, CalendarDay>((data?.days ?? []).map((d) => [d.date, d]));

  const today = new Date().toISOString().slice(0, 10);

  const setMonth = (offset: number | null) => {
    const next = new URLSearchParams(params);
    if (offset === null) {
      next.delete("month"); // Today
    } else {
      const d = new Date(Date.UTC(year, monthIndex + offset, 1));
      next.set("month", d.toISOString().slice(0, 7));
    }
    setParams(next);
  };

  /** Day-number / overflow click: the list view filtered to that day. */
  const openDayInList = (date: string) => {
    const next = new URLSearchParams(params);
    next.delete("view");
    next.delete("month");
    next.set("dueFrom", date);
    next.set("dueTo", date);
    setParams(next);
  };

  const monthLabel = new Date(Date.UTC(year, monthIndex, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="calendar" data-testid="calendar">
      <div className="calendar-nav">
        <button className="btn-ghost" onClick={() => setMonth(-1)} aria-label="Previous month">
          ‹
        </button>
        <span className="calendar-month-label">{monthLabel}</span>
        <button className="btn-ghost" onClick={() => setMonth(1)} aria-label="Next month">
          ›
        </button>
        <button className="btn" onClick={() => setMonth(null)}>
          Today
        </button>
      </div>

      <div className="calendar-grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="calendar-weekday">
            {d}
          </div>
        ))}
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <div key={`blank-${i}`} className="calendar-cell calendar-blank" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, "0")}`;
          const day = byDate.get(date);
          const overdue = date < today && (day?.incomplete ?? 0) > 0;
          return (
            <div key={date} className={`calendar-cell ${date === today ? "calendar-today" : ""}`}>
              <button
                className={`calendar-daynum ${overdue ? "overdue" : ""}`}
                onClick={() => openDayInList(date)}
                title="Show this day in the list"
              >
                {i + 1}
              </button>
              {day?.items.map((item) => <CellItem key={item.id} item={item} onOpen={onOpen} />)}
              {day && day.total > day.items.length && (
                <button className="calendar-more" onClick={() => openDayInList(date)}>
                  +{day.total - day.items.length} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CellItem({ item, onOpen }: { item: CalendarItem; onOpen: (id: string) => void }) {
  return (
    <button
      className={`calendar-item status-${item.status}`}
      onClick={() => onOpen(item.id)}
      title={item.name}
    >
      <StatusDot status={item.status} />
      <span className="calendar-item-name">
        {item.name}
        {item.isRecurring ? " ↻" : ""}
      </span>
    </button>
  );
}
