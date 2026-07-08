import type { Status } from "@shared/todo-schemas";

/**
 * The R-1.8 state machine — this table is the single authority; the service
 * guard and the UI's action menus both derive from it.
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
 * Only edges INTO in_progress/completed run the blocked guard (R-3.4);
 * edges to not_started/archived are always free — guarding them would trap
 * a completed task forever once one of its dependencies got reopened (A10).
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

/** For UIs: every status reachable from `from` (drives the row action menu). */
export function legalTargets(from: Status): readonly Status[] {
  return LEGAL_TRANSITIONS[from];
}
