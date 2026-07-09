import { useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { STATUS_LABELS, PRIORITY_LABELS } from "../lib/labels.js";

/**
 * All list state lives in the URL (spec: refresh/back/share reproduce the
 * exact view). Every control writes search params; the list reads them.
 * Default status filter excludes archived (display principle 2).
 */
export const DEFAULT_STATUSES = "not_started,in_progress,completed";

export function FilterBar({ calendarMode = false }: { calendarMode?: boolean }) {
  const [params, setParams] = useSearchParams();

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    next.delete("page"); // any filter change resets pagination
    setParams(next);
  };

  // Debounced search box
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    const handle = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) set("q", q || null);
    }, 300);
    return () => clearTimeout(handle);
    // deliberately depends only on q — `set` reads fresh params each call
  }, [q]);

  const status = params.get("status") ?? DEFAULT_STATUSES;
  const overdueActive = params.get("overdue") === "true";

  return (
    <div className="filter-bar">
      <input
        type="text"
        placeholder="Search…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search todos"
      />

      <select
        value={status}
        onChange={(e) => set("status", e.target.value === DEFAULT_STATUSES ? null : e.target.value)}
        aria-label="Status filter"
      >
        <option value={DEFAULT_STATUSES}>Active (default)</option>
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
        <option value="not_started,in_progress,completed,archived">All statuses</option>
      </select>

      <select
        value={params.get("priority") ?? ""}
        onChange={(e) => set("priority", e.target.value || null)}
        aria-label="Priority filter"
      >
        <option value="">Any priority</option>
        {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      {calendarMode ? (
        <span className="spacer" />
      ) : (
        <>
      <select
        value={params.get("blocked") ?? ""}
        onChange={(e) => set("blocked", e.target.value || null)}
        aria-label="Blocked filter"
      >
        <option value="">Blocked or not</option>
        <option value="true">🔒 Blocked</option>
        <option value="false">Unblocked</option>
      </select>

      <button
        type="button"
        className={`chip ${overdueActive ? "active" : ""}`}
        onClick={() => set("overdue", overdueActive ? null : "true")}
        title="Due before now and not completed/archived"
      >
        Overdue
      </button>

      <DateRange
        label="Due"
        from={params.get("dueFrom")}
        to={params.get("dueTo")}
        onFrom={(v) => set("dueFrom", v)}
        onTo={(v) => set("dueTo", v)}
      />
      <DateRange
        label="Created"
        from={params.get("createdFrom")}
        to={params.get("createdTo")}
        onFrom={(v) => set("createdFrom", v)}
        onTo={(v) => set("createdTo", v)}
      />

      <span className="spacer" />

      <span className="filter-label">Sort</span>
      <select
        value={params.get("sortBy") ?? "createdAt"}
        onChange={(e) => set("sortBy", e.target.value === "createdAt" ? null : e.target.value)}
        aria-label="Sort by"
      >
        <option value="createdAt">Created</option>
        <option value="dueDate">Due date</option>
        <option value="priority">Priority</option>
        <option value="status">Status</option>
        <option value="name">Name</option>
      </select>
      <select
        value={params.get("order") ?? "desc"}
        onChange={(e) => set("order", e.target.value === "desc" ? null : e.target.value)}
        aria-label="Sort order"
      >
        <option value="desc">↓</option>
        <option value="asc">↑</option>
      </select>
        </>
      )}
    </div>
  );
}

/** A labeled from–to pair of native date inputs. */
function DateRange({
  label,
  from,
  to,
  onFrom,
  onTo,
}: {
  label: string;
  from: string | null;
  to: string | null;
  onFrom: (v: string | null) => void;
  onTo: (v: string | null) => void;
}) {
  return (
    <span className="inline-row" style={{ gap: 4 }}>
      <span className="filter-label">{label}</span>
      <input
        type="date"
        value={from ?? ""}
        onChange={(e) => onFrom(e.target.value || null)}
        aria-label={`${label} from`}
      />
      <span className="filter-label">–</span>
      <input
        type="date"
        value={to ?? ""}
        onChange={(e) => onTo(e.target.value || null)}
        aria-label={`${label} to`}
      />
    </span>
  );
}

/** Date-only URL param → inclusive ISO bound (from = 00:00, to = 23:59:59.999, local). */
function dayBound(date: string, edge: "start" | "end"): string {
  return new Date(`${date}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}`).toISOString();
}

/** Translate URL params into the API query string. */
export function buildApiSearch(params: URLSearchParams): string {
  const api = new URLSearchParams();
  api.set("status", params.get("status") ?? DEFAULT_STATUSES);
  for (const key of ["priority", "blocked", "q", "sortBy", "order", "page"]) {
    const v = params.get(key);
    if (v) api.set(key, v);
  }
  const ranges: Array<[string, string, "start" | "end"]> = [
    ["dueFrom", "dueAfter", "start"],
    ["dueTo", "dueBefore", "end"],
    ["createdFrom", "createdAfter", "start"],
    ["createdTo", "createdBefore", "end"],
  ];
  for (const [param, apiKey, edge] of ranges) {
    const v = params.get(param);
    if (v) api.set(apiKey, dayBound(v, edge));
  }
  if (params.get("overdue") === "true") {
    // overdue = due before now AND still actionable (overrides a dueTo bound)
    api.set("dueBefore", new Date().toISOString());
    api.set("status", "not_started,in_progress");
  }
  return `?${api.toString()}`;
}
