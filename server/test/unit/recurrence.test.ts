import { describe, expect, it } from "vitest";
import { nextDueDate } from "../../src/domain/recurrence.js";
import type { Recurrence } from "@shared/todo-schemas";

const utc = (s: string) => new Date(s);
const rec = (frequency: Recurrence["frequency"], interval = 1): Recurrence => ({
  frequency,
  interval,
});

describe("nextDueDate (R-2.2, R-2.3, R-2.5)", () => {
  it("daily / weekly / monthly, completed on time → one period forward", () => {
    const now = utc("2026-07-08T00:00:00Z");
    const due = utc("2026-07-10T09:00:00Z"); // due is still ahead
    expect(nextDueDate(rec("daily"), due, now)).toEqual(utc("2026-07-11T09:00:00Z"));
    expect(nextDueDate(rec("weekly"), due, now)).toEqual(utc("2026-07-17T09:00:00Z"));
    expect(nextDueDate(rec("monthly"), due, now)).toEqual(utc("2026-08-10T09:00:00Z"));
  });

  it("custom interval: every 3 days, every 2 weeks", () => {
    const now = utc("2026-07-08T00:00:00Z");
    const due = utc("2026-07-10T09:00:00Z");
    expect(nextDueDate(rec("daily", 3), due, now)).toEqual(utc("2026-07-13T09:00:00Z"));
    expect(nextDueDate(rec("weekly", 2), due, now)).toEqual(utc("2026-07-24T09:00:00Z"));
  });

  it("month-end clamp: Jan 31 → Feb 28 (Feb 29 in leap years)", () => {
    const now = utc("2026-01-15T00:00:00Z");
    expect(nextDueDate(rec("monthly"), utc("2026-01-31T09:00:00Z"), now)).toEqual(
      utc("2026-02-28T09:00:00Z")
    );
    const nowLeap = utc("2028-01-15T00:00:00Z");
    expect(nextDueDate(rec("monthly"), utc("2028-01-31T09:00:00Z"), nowLeap)).toEqual(
      utc("2028-02-29T09:00:00Z")
    );
  });

  it("overdue completion skips missed periods and keeps the weekday anchor (A2)", () => {
    // Weekly, due Friday Jul 10; completed Monday Jul 20 (10 days late).
    // Jul 17 (missed) is skipped → Jul 24, still a Friday.
    const next = nextDueDate(
      rec("weekly"),
      utc("2026-07-10T09:00:00Z"),
      utc("2026-07-20T12:00:00Z")
    );
    expect(next).toEqual(utc("2026-07-24T09:00:00Z"));
    expect(next!.getUTCDay()).toBe(5); // Friday
  });

  it("anchor never drifts across a clamped month: Jan 31 overdue by 2 months → Mar 31", () => {
    // Repeated addition would give Jan 31 → Feb 28 → Mar 28. Computing from
    // the anchor gives Mar 31.
    const next = nextDueDate(
      rec("monthly"),
      utc("2026-01-31T09:00:00Z"),
      utc("2026-03-05T00:00:00Z")
    );
    expect(next).toEqual(utc("2026-03-31T09:00:00Z"));
  });

  it("many missed periods: daily task 100 days overdue → tomorrow-ish, not 100 spawns", () => {
    const next = nextDueDate(
      rec("daily"),
      utc("2026-01-01T09:00:00Z"),
      utc("2026-04-11T08:00:00Z")
    );
    expect(next).toEqual(utc("2026-04-11T09:00:00Z"));
  });

  it("undated stays undated (R-2.3)", () => {
    expect(nextDueDate(rec("daily"), null, new Date())).toBeNull();
  });

  it("next is strictly in the future even when a candidate equals now", () => {
    const due = utc("2026-07-10T09:00:00Z");
    const now = utc("2026-07-11T09:00:00Z"); // exactly the k=1 candidate
    expect(nextDueDate(rec("daily"), due, now)).toEqual(utc("2026-07-12T09:00:00Z"));
  });
});
