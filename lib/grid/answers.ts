import type { GridDataset } from "./generator";
import { resolveCriterionLabel } from "./generator";
import type { Category } from "./types";

export interface CellAnswers {
  r: number;
  c: number;
  count: number;
  players: { id: number; name: string }[];
}

/**
 * Computes every player who satisfies both the row and column criterion of a
 * cell, using the in-memory membership index. Used by the /api/cell-answers
 * endpoint and the /answers page (live DB queries, not the answer key).
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
  const rowSet = rowKey === null ? new Set<number>() : dataset.members[rowType].get(rowKey) ?? new Set();
  const colSet = colKey === null ? new Set<number>() : dataset.members[colType].get(colKey) ?? new Set();

  const [small, large] = rowSet.size <= colSet.size ? [rowSet, colSet] : [colSet, rowSet];
  const ids = new Set<number>();
  for (const id of small) {
    if (large.has(id)) ids.add(id);
  }

  const names = new Map<number, string>();
  for (const id of ids) {
    const name = dataset.players.get(id)?.name;
    if (name) names.set(id, name);
  }
  return { ids, names };
}