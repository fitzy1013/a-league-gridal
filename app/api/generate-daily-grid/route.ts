import { isAuthorizedCron } from "@/lib/cron-auth";
import { loadGridDataset } from "@/lib/db/grid-loader";
import { createAdminClient } from "@/lib/db/supabase-admin";
import { generateGrid } from "@/lib/grid/generator";

export const maxDuration = 60;

/**
 * Generates and upserts today's grid. Triggered by the Vercel cron in
 * vercel.json (04:00 UTC, after scrape-stats on scrape days).
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();

  const dataset = await loadGridDataset(supabase);
  const grid = generateGrid(dataset);

  const today = new Date().toISOString().slice(0, 10);
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

  return Response.json({
    ok: true,
    date: today,
    rowTypes: grid.rowTypes,
    colTypes: grid.colTypes,
    durationMs: Date.now() - startedAt,
  });
}