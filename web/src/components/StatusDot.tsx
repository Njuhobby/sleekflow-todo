import type { Status } from "@shared/todo-schemas";

/**
 * Shape + color, never hue alone (tiny markers of muted blue vs muted green
 * are indistinguishable): hollow ring = not started, filled blue = in
 * progress, green check = completed, filled brown = archived.
 * Shared by the calendar cells and the dependency flow.
 */
export function StatusDot({ status }: { status: Status }) {
  if (status === "completed") {
    return (
      <svg className="cal-dot" viewBox="0 0 10 10" aria-hidden="true">
        <path
          d="M1.5 5.5l2.5 2.5 4.5-5.5"
          fill="none"
          stroke="var(--dot-completed)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return <span className={`cal-dot dot-${status}`} />;
}
