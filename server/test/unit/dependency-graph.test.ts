import { describe, expect, it } from "vitest";
import type { Edge } from "../../src/domain/dependency-graph.js";
import { findCycle } from "../../src/domain/dependency-graph.js";

const edge = (dependentId: string, dependencyId: string): Edge => ({
  dependentId,
  dependencyId,
});

describe("findCycle (D5)", () => {
  it("self-dependency is a cycle of length one", () => {
    expect(findCycle([], "A", ["A"])).toEqual(["A", "A"]);
  });

  it("direct cycle: A→B exists, adding B→A", () => {
    expect(findCycle([edge("A", "B")], "B", ["A"])).toEqual(["B", "A", "B"]);
  });

  it("transitive cycle: A→B→C exists, adding C→A", () => {
    const edges = [edge("A", "B"), edge("B", "C")];
    expect(findCycle(edges, "C", ["A"])).toEqual(["C", "A", "B", "C"]);
  });

  it("diamond is legal: D→B→A and D→C→A", () => {
    const edges = [edge("B", "A"), edge("C", "A")];
    expect(findCycle(edges, "D", ["B", "C"])).toBeNull();
  });

  it("replacement semantics: the dependent's OLD edges don't count", () => {
    // A currently depends on B. Replacing A's deps with [C] removes A→B,
    // so B→A + (A→C) has no cycle even though B depends on A.
    const edges = [edge("A", "B"), edge("B", "A")]; // pre-existing (hypothetical)
    expect(findCycle(edges, "A", ["C"])).toBeNull();
  });

  it("no false positive on shared subtrees far from the dependent", () => {
    const edges = [edge("X", "Y"), edge("Y", "Z")];
    expect(findCycle(edges, "A", ["X"])).toBeNull();
  });

  it("finds a cycle buried behind a long chain", () => {
    const edges = [edge("B", "C"), edge("C", "D"), edge("D", "E"), edge("E", "A")];
    expect(findCycle(edges, "A", ["B"])).toEqual(["A", "B", "C", "D", "E", "A"]);
  });

  it("empty dependency list never cycles", () => {
    expect(findCycle([edge("A", "B")], "A", [])).toBeNull();
  });
});
