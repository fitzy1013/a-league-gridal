import type { GridDataset } from "./generator";
import { clubStatKey, resolveCriterionLabel } from "./generator";
import { isPairAwareCategory, type BandedCategory, type Category } from "./types";

export interface CellAnswers {
  r: number;
  c: number;
  count: number;
  players: { id: number; name: string }[];
}

/**
 * Computes every player who satisfies both cell criteria, using the in-memory
 * membership index. Pair-aware: a Club x stat cell uses the per-club stat
 * membership (e.g. "Melbourne Victory x 20+ Goals" = 20+ goals FOR Victory),
 * while stat x stat cells are career-level intersections.
 *
 * Used by the /api/cell-answers endpoint and the /answers page (live DB
 * queries, not the answer key).
 */
export function cellAnswers(
  dataset: GridDataset,
  rowType: Category,
  rowValue: string,
  colType: Category,
  colValue: string,
): { ids: Set<number>; names: Map<number, string> } {
  const rowKey = resolveCriterionLabel(dataset, rowType, rowValue);
  const colKey = resolveCriterionLabel(dataset, colType, colValue);
  const rowSet =
    rowKey === null ? new Set<number>() : dataset.members[rowType].get(rowKey) ?? new Set();
  const colSet =
    colKey === null ? new Set<number>() : dataset.members[colType].get(colKey) ?? new Set();

  let ids: Set<number>;
  if (rowType === "club" && colKey !== null && isPairAwareCategory(colType)) {
    ids =
      dataset.clubStatMembers.get(clubStatKey(rowKey!, colType as BandedCategory, colKey)) ??
      new Set();
  } else if (colType === "club" && rowKey !== null && isPairAwareCategory(rowType)) {
    ids =
      dataset.clubStatMembers.get(clubStatKey(colKey!, rowType as BandedCategory, rowKey)) ??
      new Set();
  } else {
    const [small, large] = rowSet.size <= colSet.size ? [rowSet, colSet] : [colSet, rowSet];
    ids = new Set<number>();
    for (const id of small) {
      if (large.has(id)) ids.add(id);
    }
  }

  const names = new Map<number, string>();
  for (const id of ids) {
    const name = dataset.players.get(id)?.name;
    if (name) names.set(id, name);
  }
  return { ids, names };
}
