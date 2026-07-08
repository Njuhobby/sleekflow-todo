import type { Priority, Status } from "@shared/todo-schemas";
import { PRIORITY_LABELS, STATUS_LABELS } from "../lib/labels.js";

export function StatusPill({ status }: { status: Status }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function PriorityPill({ priority }: { priority: Priority }) {
  return <span className={`pill pill-${priority}`}>{PRIORITY_LABELS[priority]}</span>;
}
