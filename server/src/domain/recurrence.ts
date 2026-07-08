import { addDays, addMonths, addWeeks } from "date-fns";
import type { Recurrence } from "@shared/todo-schemas";

const ADD = {
  daily: addDays,
  weekly: addWeeks,
  monthly: addMonths,
} as const;

/**
 * Due date for the next occurrence (R-2.2, R-2.3, R-2.5, A2).
 *
 * next = previousDue + k × interval, for the smallest k ≥ 1 that lands
 * strictly after `now`:
 *   - on-time completion → k = 1, identical to the naive rule
 *   - overdue completion → missed periods are skipped, and because every
 *     candidate is computed FROM THE ORIGINAL anchor (not by repeated
 *     addition), the cadence anchor never drifts:
 *       Jan 31 +1mo = Feb 28 (clamped), but +2mo = Mar 31 — not Mar 28.
 *     date-fns addMonths does the month-end clamping natively.
 *   - undated tasks spawn undated occurrences (an undated series never
 *     silently becomes a dated one) → null.
 */
export function nextDueDate(
  recurrence: Recurrence,
  previousDue: Date | null,
  now: Date
): Date | null {
  if (!previousDue) return null;

  const add = ADD[recurrence.frequency];
  for (let k = 1; ; k++) {
    const candidate = add(previousDue, recurrence.interval * k);
    if (candidate > now) return candidate;
  }
}
