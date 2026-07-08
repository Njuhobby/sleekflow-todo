import type { Status, Priority } from "@shared/todo-schemas";

export const STATUS_LABELS: Record<Status, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  archived: "Archived",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** Action-menu wording for a transition edge (driven by the R-1.8 table). */
export function transitionLabel(from: Status, to: Status): string {
  if (to === "in_progress") return from === "completed" ? "Reopen" : "Start";
  if (to === "completed") return "Complete";
  if (to === "archived") return "Archive";
  // to === "not_started"
  return from === "archived" ? "Unarchive" : "Move to Not started";
}

export function formatDue(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ISO ↔ <input type="datetime-local"> value */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
