import { createAdminClient } from "../db/supabase-admin";
import { loadGridDataset } from "../db/grid-loader";
import { generateGrid, setThrowbackBoost, type GridDataset } from "./generator";
import { NUMERIC_BANDS } from "./labels";
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

export type DailyTheme = "achievement" | "balanced" | "veryChallenging" | "throwback" | "deepThrowback" | "statHeavy";

const ACHIEVEMENT_CATEGORIES = new Set<string>([
  "championships",
  "premierships",
  "golden_boot",
  "jw_medal",
  "marston_medal",
  "finals_goals",
  "finals_apps",
  "multi_goal_game",
]);

/** Sydney-local day-of-week → theme. Mon=achievement, Tue=balanced, Wed=veryChallenging, Thu=throwback pre-2013/14, Fri=balanced, Sat=statHeavy, Sun=deepThrowback pre-09/10 */
export function themeForDate(dateStr: string): DailyTheme {
  // dateStr is YYYY-MM-DD in Sydney; parse as Sydney midnight
  const d = new Date(`${dateStr}T12:00:00+10:00`);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  switch (day) {
    case 1: return "achievement";
    case 2: return "balanced";
    case 3: return "veryChallenging";
    case 4: return "throwback";
    case 5: return "balanced";
    case 6: return "statHeavy";
    case 0: return "deepThrowback";
    default: return "balanced";
  }
}

export function themeLabel(theme: DailyTheme): string {
  switch (theme) {
    case "achievement": return "Achievement Day — ≥2 of Championships/Premierships/Awards/Finals/Multi-goal";
    case "balanced": return "Balanced";
    case "veryChallenging": return "Very Challenging";
    case "throwback": return "Throwback — Era ending ≤2013/14";
    case "deepThrowback": return "Deep Throwback — Era ending ≤09/10";
    case "statHeavy": return "Stat Heavy";
  }
}

function gridMeetsTheme(grid: GridSpec, theme: DailyTheme): boolean {
  const cats = [...grid.rowTypes, ...grid.colTypes] as string[];
  const vals = [...grid.rowValues, ...grid.colValues];
  if (theme === "achievement") {
    const count = cats.filter((c) => ACHIEVEMENT_CATEGORIES.has(c)).length;
    if (count < 2) return false;
  }
  if (theme === "throwback") {
    // End-year rule: must finish at most in 2013/14 (band.max <= 2013) — so 2013/14 to 2014/15 is excluded
    const eraIndices = cats.map((c, i) => c === "era" ? i : -1).filter((i) => i >= 0);
    if (eraIndices.length < 1) return false;
    for (const idx of eraIndices) {
      const band = NUMERIC_BANDS.era.find((b) => b.label === vals[idx]);
      if (!band || band.max > 2013) return false;
    }
  }
  if (theme === "deepThrowback") {
    // End-year rule: must finish at most in 09/10 (band.max <= 2009) — so 2009/10 to 2010/11 is excluded
    const eraIndices = cats.map((c, i) => c === "era" ? i : -1).filter((i) => i >= 0);
    if (eraIndices.length < 1) return false;
    for (const idx of eraIndices) {
      const band = NUMERIC_BANDS.era.find((b) => b.label === vals[idx]);
      if (!band || band.max > 2009) return false;
    }
  }
  if (theme === "statHeavy") {
    const numeric = new Set(["appearances","goals","minutes","win_pct","yellow_cards","red_cards","clean_sheets","debut_age","championships","premierships","own_goals","finals_goals","finals_apps","multi_goal_game"]);
    const numericCount = cats.filter((c) => numeric.has(c)).length;
    if (numericCount < 4) return false;
    const clubCount = cats.filter((c) => c === "club").length;
    if (clubCount > 1) return false;
  }
  return true;
}

function optionsForTheme(theme: DailyTheme): Partial<import("./generator").GenerateGridOptions> {
  switch (theme) {
    case "veryChallenging":
      return { minHardCells: 3, hardCellMaxAnswers: 8, minGoodCells: 6, maxFatCells: 0, goodCandidateCount: 3 };
    case "throwback":
      // Lax for 2× era (otherwise infeasible) — allow any difficulty, try 2 but fallback to 1 if needed
      return { minHardCells: 0, hardCellMaxAnswers: 50, minGoodCells: 0, maxFatCells: 9, goodCandidateCount: 1, maxSingletonCells: 3, requiredCategories: [{ category: "era", count: 1 }] };
    case "deepThrowback":
      return { minHardCells: 0, hardCellMaxAnswers: 50, minGoodCells: 0, maxFatCells: 9, goodCandidateCount: 1, maxSingletonCells: 3, requiredCategories: [{ category: "era", count: 1 }] };
    case "statHeavy":
      return { minHardCells: 1, hardCellMaxAnswers: 10, minGoodCells: 4, maxFatCells: 2, minDistinctClubs: 0, maxDistinctClubs: 1 };
    case "achievement":
      return { minHardCells: 1, hardCellMaxAnswers: 10, minGoodCells: 4, maxFatCells: 2 };
    case "balanced":
    default:
      return {};
  }
}

/** Generates a candidate grid from a context without touching the database. */
export function buildDailyCandidate(ctx: DailyContext, themeOverride?: DailyTheme): GridSpec {
  const dateForTheme = (ctx as any).dateForTheme as string | undefined;
  const theme = themeOverride ?? (dateForTheme ? themeForDate(dateForTheme) : "balanced");
  // For throwback / deepThrowback, don't ban era criteria
  const bannedForTheme = theme === "throwback" || theme === "deepThrowback"
    ? ctx.bannedCriteria.filter((c) => !c.startsWith("era:"))
    : ctx.bannedCriteria;
  const baseOpts = {
    exclude: ctx.exclude,
    minDiffCriteria: 2,
    excludeClubs: ctx.excludedClubs,
    excludeCriteria: bannedForTheme,
    clubWeights: CLUB_WEIGHTS,
  };
  const themeOpts = optionsForTheme(theme);

  // For throwback / deepThrowback, restrict era by filtering dataset + boost
  let datasetForTheme = ctx.dataset;
  const eraCap = theme === "throwback" ? 2013 : theme === "deepThrowback" ? 2009 : null;
  if (eraCap !== null) {
    setThrowbackBoost(true);
    const filteredMembers = { ...ctx.dataset.members };
    const eraMap = new Map<string, Set<number>>();
    for (const [label, set] of ctx.dataset.members["era"]) {
      const band = NUMERIC_BANDS.era.find((b) => b.label === label);
      if (band && band.max <= eraCap) eraMap.set(label, set);
    }
    filteredMembers["era"] = eraMap;
    datasetForTheme = { ...ctx.dataset, members: filteredMembers as any, eraClubMembers: ctx.dataset.eraClubMembers, eraStatMembers: ctx.dataset.eraStatMembers } as GridDataset;
  } else {
    setThrowbackBoost(false);
  }

  // Try up to 500 times to meet theme-specific category requirements
  let bestGrid: GridSpec | null = null;
  let bestEraCount = -1;
  for (let attempt = 0; attempt < 500; attempt++) {
    const grid = generateGrid(datasetForTheme, { ...baseOpts, ...themeOpts });
    if (gridMeetsTheme(grid, theme)) {
      if (theme === "throwback" || theme === "deepThrowback") setThrowbackBoost(false);
      return grid;
    }
    if (theme === "throwback" || theme === "deepThrowback") {
      const eraCount = [...grid.rowTypes, ...grid.colTypes].filter((c) => c === "era").length;
      if (eraCount > bestEraCount) {
        bestEraCount = eraCount;
        bestGrid = grid;
      }
    }
    if (theme === "balanced" || theme === "veryChallenging") {
      return grid;
    }
  }
  // Fallback: return best attempt for throwback, otherwise random
  setThrowbackBoost(false);
  if (bestGrid) return bestGrid;
  return generateGrid(datasetForTheme, { ...baseOpts, ...themeOpts });
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
    ruleset: "v2",
  };
  const { error } = await supabase.from("grids").upsert(row, { onConflict: "date" });
  if (error) throw new Error(`upsert grid: ${error.message}`);
  return row.date;
}

export interface GeneratedDailyResult {
  date: string;
  grid: GridSpec;
  upserted: boolean;
}

/**
 * Loads the dataset and upserts today's grid. Used by
 * /api/generate-daily-grid (Vercel cron) and scripts/generate-grid.ts.
 *
 * Idempotent: when a grid already exists for the target date (e.g. one
 * pre-approved via /admin/daily for tomorrow), generation is skipped unless
 * forced.
 */
export async function generateDailyGrid(
  dataset?: GridDataset,
  opts?: { force?: boolean; themeOverride?: DailyTheme },
): Promise<GeneratedDailyResult> {
  const supabase = createAdminClient();
  const date = todaySydneyDate();
  const theme = opts?.themeOverride ?? themeForDate(date);

  if (!opts?.force) {
    const { data: existing } = await supabase
      .from("grids")
      .select("row_type,col_type,row_values,col_values,solution")
      .eq("date", date)
      .maybeSingle();
    if (existing) {
      const grid = {
        rowTypes: JSON.parse(existing.row_type) as Category[],
        colTypes: JSON.parse(existing.col_type) as Category[],
        rowValues: existing.row_values as string[],
        colValues: existing.col_values as string[],
        solution: existing.solution as GridSpec["solution"],
      };
      return { date, grid, upserted: false };
    }
  }

  const ctx = await loadDailyContext(supabase, dataset);
  const grid = buildDailyCandidate(ctx, theme);
  await storeDailyGrid(supabase, grid, date);
  return { date, grid, upserted: true };
}