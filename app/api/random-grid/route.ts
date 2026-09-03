import { loadGridDataset } from "@/lib/db/grid-loader";
import { createAdminClient } from "@/lib/db/supabase-admin";
import { generateGrid } from "@/lib/grid/generator";
import { buildDailyCandidate, loadDailyContext, type DailyTheme, themeForDate } from "@/lib/grid/generate-daily";
import { todaySydneyDate } from "@/lib/dates";

/** Generates a fresh unlimited grid on demand (not stored in the DB). Accepts optional {theme} for dev preview. */
export async function POST(req?: Request) {
  const supabase = createAdminClient();
  const dataset = await loadGridDataset(supabase);
  let theme: DailyTheme | undefined;
  try {
    const body = (await req?.json().catch(() => null)) as { theme?: DailyTheme } | null;
    if (body?.theme) theme = body.theme;
  } catch {}
  // Dev preview: if theme provided, use daily theme logic; otherwise random unlimited
  if (theme) {
    const ctx = await loadDailyContext(supabase, dataset);
    const grid = buildDailyCandidate(ctx, theme);
    return Response.json({
      id: null,
      mode: "unlimited",
      rowTypes: grid.rowTypes,
      colTypes: grid.colTypes,
      rowValues: grid.rowValues,
      colValues: grid.colValues,
      solution: grid.solution,
      theme,
    });
  }
  const grid = generateGrid(dataset);

  return Response.json({
    id: null,
    mode: "unlimited",
    rowTypes: grid.rowTypes,
    colTypes: grid.colTypes,
    rowValues: grid.rowValues,
    colValues: grid.colValues,
    solution: grid.solution,
  });
}