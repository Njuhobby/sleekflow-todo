import type { Status, TodoDetail } from "@shared/todo-schemas";
import { isLegalTransition, requiresUnblocked } from "@shared/transitions";
import { STATUS_LABELS } from "../lib/labels.js";

/**
 * The whole state machine, always visible, as a flow strip:
 *
 *   Not started → In progress → Completed │ Archived
 *
 * Draft semantics: clicking a reachable status selects it as the DRAFT
 * target (dashed ring); nothing hits the server until Save. Clicking the
 * task's actual status clears the draft. Reachability always derives from
 * the SERVER status (one hop of the shared transition table — the same one
 * the server enforces), so a draft can never express an illegal edge.
 * A 🔒 marks reachable-but-guarded targets; the server names the exact
 * reason at save time if it refuses.
 */
export function StatusFlow({
  todo,
  draftStatus,
  onSelect,
}: {
  todo: TodoDetail;
  draftStatus: Status | null;
  onSelect: (to: Status | null) => void;
}) {
  const hasActiveDependents = todo.dependents.some((d) => d.status === "in_progress");
  const display = draftStatus ?? todo.status;

  const node = (to: Status) => {
    if (to === display) {
      return (
        <span
          className={`flow-node flow-current pill-${to} ${draftStatus ? "flow-pending" : ""}`}
          aria-current="step"
          title={draftStatus ? "Selected — applies when you save" : undefined}
        >
          {STATUS_LABELS[to]}
        </span>
      );
    }
    // the real current status while a draft target is selected → click to revert
    const isRevert = to === todo.status;
    if (!isRevert && !isLegalTransition(todo.status, to)) {
      return <span className="flow-node flow-off">{STATUS_LABELS[to]}</span>;
    }
    const lockReason = isRevert
      ? null
      : requiresUnblocked(to) && todo.isBlocked
        ? "Blocked by incomplete dependencies"
        : todo.status === "completed" && hasActiveDependents
          ? "Tasks in progress depend on this"
          : null;
    return (
      <button
        className="flow-node flow-target"
        onClick={() => onSelect(isRevert ? null : to)}
        title={
          isRevert
            ? "Back to the current status (clears the selection)"
            : (lockReason ?? `Move to ${STATUS_LABELS[to]} on save`)
        }
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
