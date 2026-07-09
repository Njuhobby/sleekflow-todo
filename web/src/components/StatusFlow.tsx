import type { Status, TodoDetail } from "@shared/todo-schemas";
import { isLegalTransition, requiresUnblocked } from "@shared/transitions";
import { STATUS_LABELS } from "../lib/labels.js";

/**
 * The whole state machine, always visible, as a flow strip:
 *
 *   Not started → In progress → Completed │ Archived
 *
 * The current status is a highlighted pill (not clickable); statuses
 * reachable from it render as buttons; unreachable ones are inert, dimmed
 * text. Reachability comes from the same shared transition table the server
 * enforces. A 🔒 marks reachable-but-guarded targets (the click still goes
 * through — the server names the exact reason if it refuses).
 */
export function StatusFlow({
  todo,
  onTransition,
}: {
  todo: TodoDetail;
  onTransition: (to: Status) => void;
}) {
  const hasActiveDependents = todo.dependents.some((d) => d.status === "in_progress");

  const node = (to: Status) => {
    if (to === todo.status) {
      return (
        <span className={`flow-node flow-current pill-${to}`} aria-current="step">
          {STATUS_LABELS[to]}
        </span>
      );
    }
    if (!isLegalTransition(todo.status, to)) {
      return <span className="flow-node flow-off">{STATUS_LABELS[to]}</span>;
    }
    const lockReason =
      requiresUnblocked(to) && todo.isBlocked
        ? "Blocked by incomplete dependencies"
        : todo.status === "completed" && hasActiveDependents
          ? "Tasks in progress depend on this"
          : null;
    return (
      <button
        className="flow-node flow-target"
        onClick={() => onTransition(to)}
        title={lockReason ?? `Move to ${STATUS_LABELS[to]}`}
      >
        {lockReason && "🔒 "}
        {STATUS_LABELS[to]}
      </button>
    );
  };

  return (
    <div className="status-flow" data-testid="status-flow">
      {node("not_started")}
      <span className="flow-arrow">→</span>
      {node("in_progress")}
      <span className="flow-arrow">→</span>
      {node("completed")}
      <span className="flow-sep" />
      {node("archived")}
    </div>
  );
}
