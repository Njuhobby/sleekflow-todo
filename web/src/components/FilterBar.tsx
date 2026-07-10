import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
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

      <MultiFilter
        label="Status"
        param="status"
        options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
        defaultValues={DEFAULT_STATUSES.split(",")}
        defaultSummary="Active"
      />

      <MultiFilter
        label="Priority"
        param="priority"
        options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))}
        defaultValues={Object.keys(PRIORITY_LABELS)}
        defaultSummary="Any"
      />

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
        </>
      )}
    </div>
  );
}

/**
 * Multi-select filter as a checkbox dropdown (the API takes CSV lists — this
 * finally exposes that). Toggling keeps the menu open; clearing everything
 * falls back to the default set rather than an empty (nothing-matches) list.
 */
function MultiFilter({
  label,
  param,
  options,
  defaultValues,
  defaultSummary,
}: {
  label: string;
  param: string;
  options: Array<{ value: string; label: string }>;
  defaultValues: string[];
  defaultSummary: string;
}) {
  const [params, setParams] = useSearchParams();
  const raw = params.get(param);
  const selected = raw ? raw.split(",") : [...defaultValues];

  const toggle = (value: string) => {
    const nextSet = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    // canonical order, so the URL is stable regardless of click order
    const canonical = options.map((o) => o.value).filter((v) => nextSet.includes(v));
    const next = new URLSearchParams(params);
    const isDefault =
      canonical.length === 0 || canonical.join(",") === defaultValues.join(",");
    if (isDefault) next.delete(param);
    else next.set(param, canonical.join(","));
    next.delete("page");
    setParams(next);
  };

  const isDefault = !raw;
  const summary = isDefault
    ? defaultSummary
    : selected.length <= 2
      ? options.filter((o) => selected.includes(o.value)).map((o) => o.label).join(", ")
      : `${selected.length} selected`;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className={`filter-btn ${isDefault ? "" : "filter-active"}`} aria-label={`${label} filter`}>
          {label}: {summary} <span className="filter-caret">▾</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu-content" align="start" sideOffset={4}>
          {options.map((o) => (
            <DropdownMenu.CheckboxItem
              key={o.value}
              className="menu-item filter-check"
              checked={selected.includes(o.value)}
              onSelect={(e) => {
                e.preventDefault(); // keep the menu open while toggling
                toggle(o.value);
              }}
            >
              <span className="filter-checkmark">
                <DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator>
              </span>
              {o.label}
            </DropdownMenu.CheckboxItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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

/**
 * Translate URL params into the API query string.
 * Returns null when the combination is unsatisfiable (e.g. Overdue +
 * status=Completed): a finished task can never be overdue, so the caller
 * shows an empty result without asking the server.
 */
export function buildApiSearch(params: URLSearchParams): string | null {
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
    api.set("dueBefore", new Date().toISOString());
    // Overdue INTERSECTS the status selection (never overrides it): overdue
    // means "due before now AND still actionable" (display principle 1).
    const actionable = ["not_started", "in_progress"];
    const selected = (params.get("status") ?? DEFAULT_STATUSES).split(",");
    const intersection = selected.filter((s) => actionable.includes(s));
    if (intersection.length === 0) return null; // e.g. Completed ∩ overdue = ∅
    api.set("status", intersection.join(","));
  }
  return `?${api.toString()}`;
}
