import { describe, expect, it } from "vitest";
import type { Status } from "@shared/todo-schemas";
import { isLegalTransition, legalTargets, requiresUnblocked } from "../../src/domain/transitions.js";

const ALL: Status[] = ["not_started", "in_progress", "completed", "archived"];

describe("transitions — the full R-1.8 edge matrix", () => {
  const legal: Array<[Status, Status]> = [
    ["not_started", "in_progress"],
    ["not_started", "completed"], // direct complete is allowed
    ["not_started", "archived"],
    ["in_progress", "not_started"],
    ["in_progress", "completed"],
    ["in_progress", "archived"],
    ["completed", "in_progress"], // reopen
    ["completed", "not_started"], // reopen
    ["completed", "archived"],
    ["archived", "not_started"], // unarchive — the only way out
  ];

  it.each(legal)("%s → %s is legal", (from, to) => {
    expect(isLegalTransition(from, to)).toBe(true);
  });

  it("every other edge is illegal (incl. archived → completed/in_progress)", () => {
    const legalSet = new Set(legal.map(([f, t]) => `${f}:${t}`));
    for (const from of ALL) {
      for (const to of ALL) {
        if (from === to) continue;
        if (legalSet.has(`${from}:${to}`)) continue;
        expect(isLegalTransition(from, to), `${from} → ${to}`).toBe(false);
      }
    }
  });

  it("the guard applies exactly to edges into in_progress and completed (A10)", () => {
    expect(requiresUnblocked("in_progress")).toBe(true);
    expect(requiresUnblocked("completed")).toBe(true);
    expect(requiresUnblocked("not_started")).toBe(false); // never traps (A10)
    expect(requiresUnblocked("archived")).toBe(false);
  });

  it("legalTargets drives UI menus", () => {
    expect(legalTargets("archived")).toEqual(["not_started"]);
    expect(legalTargets("not_started")).toContain("in_progress");
  });
});
