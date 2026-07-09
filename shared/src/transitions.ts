import type { Status } from "./todo-schemas.js";

/**
 * The R-1.8 state machine — single authority for BOTH sides: the server's
 * transition guard and the web UI's action menus derive from this table,
 * so the UI can never offer an edge the API would reject.
 *
 *                  ┌──────────────── unarchive ────────────────┐
 *                  ▼                                           │
 *           not_started ◄────────► in_progress             archived
 *               │  ▲                    │                      ▲
 *               │  │ reopen             ▼         archive      │
 *               │  └─────────────── completed ─────────────────┤
 *               │                       ▲  (any non-archived) ─┘
 *               └── direct complete ────┘
 *
 * Legality (this table) is necessary but not sufficient: every transition
 * must also preserve the dependency INVARIANT (R-3.0) — "a task is
 * in_progress only while all its dependencies are completed", at all times.
 * The service checks it at two points: entering in_progress/completed
 * (requiresUnblocked below) and leaving completed while dependents are
 * actively working (R-1.9). Falling back to not_started can never violate
 * the invariant, which is why it is always available.
 */
const LEGAL_TRANSITIONS: Record<Status, readonly Status[]> = {
  not_started: ["in_progress", "completed", "archived"],
  in_progress: ["not_started", "completed", "archived"],
  completed: ["in_progress", "not_started", "archived"],
  archived: ["not_started"],
};

export function isLegalTransition(from: Status, to: Status): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/** Does this edge require all dependencies to be completed? (R-3.4) */
export function requiresUnblocked(to: Status): boolean {
  return to === "in_progress" || to === "completed";
}

/** Every status reachable from `from` — drives the UI's action menus. */
export function legalTargets(from: Status): readonly Status[] {
  return LEGAL_TRANSITIONS[from];
}
