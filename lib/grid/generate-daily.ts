import { createAdminClient } from "../db/supabase-admin";
import { loadGridDataset } from "../db/grid-loader";
import { generateGrid, type GridDataset } from "./generator";
import type { GridSpec } from "./types";
import { todaySydneyDate } from "../dates";

export interface GeneratedDailyResult {
  date: string;
  grid: GridSpec;
  upserted: boolean;
}

/**
 * Loads the dataset and upserts today's grid. Used by
 * /api/generate-daily-grid (Vercel cron) and scripts/generate-grid.ts.
 */
export async function generateDailyGrid(
  dataset?: GridDataset,
): Promise<GeneratedDailyResult> {
  const supabase = createAdminClient();
  const resolvedDataset = dataset ?? (await loadGridDataset(supabase));
  const grid = generateGrid(resolvedDataset);

  const today = todaySydneyDate();
  const row = {
    date: today,
    row_type: JSON.stringify(grid.rowTypes),
    col_type: JSON.stringify(grid.colTypes),
    row_values: grid.rowValues,
    col_values: grid.colValues,
    solution: grid.solution,
  };

  const { error } = await supabase.from("grids").upsert(row, { onConflict: "date" });
  if (error) throw new Error(`upsert grid: ${error.message}`);

  return { date: today, grid, upserted: true };
}