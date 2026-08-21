import { createAdminClient } from "../db/supabase-admin";
import { loadGridDataset } from "../db/grid-loader";
import { generateGrid, type GridDataset } from "./generator";
import type { Category, GridSpec } from "./types";
import { todaySydneyDate } from "../dates";

export interface GeneratedDailyResult {
  date: string;
  grid: GridSpec;
  upserted: boolean;
}

/** How many recent grids count toward the club cooldown. */
const COOLDOWN_GRIDS = 10;
/** A club used this many times in the cooldown window sits out today. */
const MAX_CLUB_USES = 3;

/** Order-independent signature of a stored grid, matching the generator's. */
function signatureFromStoredGrid(g: {
  row_type: string;
  col_type: string;
  row_values: string[];
  col_values: string[];
}): string {
  const rt = JSON.parse(g.row_type) as Category[];
  const ct = JSON.parse(g.col_type) as Category[];
  const items = [
    ...rt.map((cat, i) => `${cat}:${g.row_values[i]}`),
    ...ct.map((cat, i) => `${cat}:${g.col_values[i]}`),
  ];
  return items.sort().join("|");
}

/** Clubs that appeared too often in the recent grids (cooldown). */
function cooledOutClubs(recent: {
  row_type: string;
  col_type: string;
  row_values: string[];
  col_values: string[];
}[]): string[] {
  const uses = new Map<string, number>();
  for (const g of recent.slice(0, COOLDOWN_GRIDS)) {
    const rt = JSON.parse(g.row_type) as Category[];
    const ct = JSON.parse(g.col_type) as Category[];
    rt.forEach((cat, i) => {
      if (cat === "club") uses.set(g.row_values[i], (uses.get(g.row_values[i]) ?? 0) + 1);
    });
    ct.forEach((cat, i) => {
      if (cat === "club") uses.set(g.col_values[i], (uses.get(g.col_values[i]) ?? 0) + 1);
    });
  }
  return [...uses].filter(([, n]) => n >= MAX_CLUB_USES).map(([name]) => name);
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

  const today = todaySydneyDate();
  const { data: recent } = await supabase
    .from("grids")
    .select("row_type,col_type,row_values,col_values")
    .lte("date", today)
    .order("date", { ascending: false })
    .limit(14);

  const exclude = (recent ?? []).map(signatureFromStoredGrid);
  const grid = generateGrid(resolvedDataset, {
    exclude,
    minDiffCriteria: 2,
    excludeClubs: cooledOutClubs(recent ?? []),
  });

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