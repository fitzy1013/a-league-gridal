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
/** A club used this many times in the cooldown window sits out today.
 * Set above the weighted average (~2.9 uses/window for active clubs) so it
 * only catches pathological streaks without fighting clubWeights. */
const MAX_CLUB_USES = 5;

/**
 * Defunct clubs appear far less often than active ones (~7% of grids vs ~28%
 * for active clubs). Weight relative to the default of 1.
 */
export const CLUB_WEIGHTS: Record<string, number> = {
  "Gold Coast United": 0.17,
  "North Queensland Fury": 0.14,
  "New Zealand Knights": 0.2,
};

/**
 * A defunct club that appeared within this many most-recent grids sits out,
 * so the same rare club can never show up on consecutive days.
 */
const RARE_SPACING_GRIDS = 3;

/** Rare clubs seen in the most recent grids (spacing rule). */
function spacedOutClubs(recent: {
  row_type: string;
  col_type: string;
  row_values: string[];
  col_values: string[];
}[]): string[] {
  const seen = new Set<string>();
  for (const g of recent.slice(0, RARE_SPACING_GRIDS)) {
    const rt = JSON.parse(g.row_type) as Category[];
    const ct = JSON.parse(g.col_type) as Category[];
    rt.forEach((cat, i) => {
      if (cat === "club") seen.add(g.row_values[i]);
    });
    ct.forEach((cat, i) => {
      if (cat === "club") seen.add(g.col_values[i]);
    });
  }
  return Object.keys(CLUB_WEIGHTS).filter((name) => seen.has(name));
}

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

export interface DailyContext {
  dataset: GridDataset;
  exclude: string[];
  excludedClubs: string[];
  /** "category:label" criteria used in the recent window — rotated out so no
   * single stat criterion dominates. Clubs are exempt (own cooldown). */
  bannedCriteria: string[];
}

/** How many recent grids count toward the stat-criterion rotation. */
const CRITERION_ROTATION_GRIDS = 14;

/** Non-club criteria seen in the recent window are rotated out. */
function bannedStatCriteria(recent: {
  row_type: string;
  col_type: string;
  row_values: string[];
  col_values: string[];
}[]): string[] {
  const seen = new Set<string>();
  for (const g of recent.slice(0, CRITERION_ROTATION_GRIDS)) {
    const rt = JSON.parse(g.row_type) as Category[];
    const ct = JSON.parse(g.col_type) as Category[];
    rt.forEach((cat, i) => {
      if (cat !== "club") seen.add(`${cat}:${g.row_values[i]}`);
    });
    ct.forEach((cat, i) => {
      if (cat !== "club") seen.add(`${cat}:${g.col_values[i]}`);
    });
  }
  return [...seen];
}

/**
 * Loads everything needed to build a daily-grid candidate (dataset + recent
 * grid exclusions + club cooldowns). Used by the cron path and the admin
 * preview endpoint.
 */
export async function loadDailyContext(
  supabase: ReturnType<typeof createAdminClient>,
  dataset?: GridDataset,
): Promise<DailyContext> {
  const resolvedDataset = dataset ?? (await loadGridDataset(supabase));

  const today = todaySydneyDate();
  const { data: recent } = await supabase
    .from("grids")
    .select("row_type,col_type,row_values,col_values")
    .lte("date", today)
    .order("date", { ascending: false })
    .limit(14);

  return {
    dataset: resolvedDataset,
    exclude: (recent ?? []).map(signatureFromStoredGrid),
    excludedClubs: [...cooledOutClubs(recent ?? []), ...spacedOutClubs(recent ?? [])],
    bannedCriteria: bannedStatCriteria(recent ?? []),
  };
}

/** Generates a candidate grid from a context without touching the database. */
export function buildDailyCandidate(ctx: DailyContext): GridSpec {
  return generateGrid(ctx.dataset, {
    exclude: ctx.exclude,
    minDiffCriteria: 2,
    excludeClubs: ctx.excludedClubs,
    excludeCriteria: ctx.bannedCriteria,
    clubWeights: CLUB_WEIGHTS,
  });
}

/** Upserts a spec as the daily grid for the given (default: today's) date. */
export async function storeDailyGrid(
  supabase: ReturnType<typeof createAdminClient>,
  grid: GridSpec,
  date?: string,
): Promise<string> {
  const row = {
    date: date ?? todaySydneyDate(),
    row_type: JSON.stringify(grid.rowTypes),
    col_type: JSON.stringify(grid.colTypes),
    row_values: grid.rowValues,
    col_values: grid.colValues,
    solution: grid.solution,
  };
  const { error } = await supabase.from("grids").upsert(row, { onConflict: "date" });
  if (error) throw new Error(`upsert grid: ${error.message}`);
  return row.date;
}

/**
 * Loads the dataset and upserts today's grid. Used by
 * /api/generate-daily-grid (Vercel cron) and scripts/generate-grid.ts.
 */
export async function generateDailyGrid(
  dataset?: GridDataset,
): Promise<GeneratedDailyResult> {
  const supabase = createAdminClient();
  const ctx = await loadDailyContext(supabase, dataset);
  const grid = buildDailyCandidate(ctx);
  const date = await storeDailyGrid(supabase, grid);
  return { date, grid, upserted: true };
}