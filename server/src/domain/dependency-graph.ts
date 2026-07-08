export interface Edge {
  dependentId: string;
  dependencyId: string;
}

/**
 * Would replacing `dependentId`'s dependencies with `newDependencyIds`
 * create a cycle? (D5, R-3.2)
 *
 * A cycle exists iff, in the graph AFTER the replacement, some new dependency
 * can reach `dependentId` by following "depends on" edges:
 *
 *      dependent ──▶ newDep ──▶ … ──▶ dependent      ← cycle!
 *
 * The graph only ever contains live tasks (deletion severs edges, R-1.4),
 * so there is no deleted-node case to handle. Diamonds are legal:
 *      D ──▶ B ──▶ A
 *      D ──▶ C ──▶ A        (two paths, no cycle)
 *
 * Returns the cycle path `[dependentId, …, dependentId]`, or null.
 */
export function findCycle(
  edges: readonly Edge[],
  dependentId: string,
  newDependencyIds: readonly string[]
): string[] | null {
  // Adjacency of the post-replacement graph: drop the dependent's old
  // outgoing edges, add the proposed ones.
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.dependentId === dependentId) continue;
    const list = adjacency.get(edge.dependentId);
    if (list) list.push(edge.dependencyId);
    else adjacency.set(edge.dependentId, [edge.dependencyId]);
  }
  adjacency.set(dependentId, [...newDependencyIds]);

  const visited = new Set<string>();
  const path: string[] = [dependentId];

  const dfs = (node: string): string[] | null => {
    for (const next of adjacency.get(node) ?? []) {
      if (next === dependentId) return [...path, next];
      if (visited.has(next)) continue;
      visited.add(next);
      path.push(next);
      const cycle = dfs(next);
      if (cycle) return cycle;
      path.pop();
    }
    return null;
  };

  return dfs(dependentId);
}
