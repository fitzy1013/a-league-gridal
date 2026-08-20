import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/db/supabase-admin";
import { loadGridDataset } from "@/lib/db/grid-loader";
import { generateDailyGrid } from "@/lib/grid/generate-daily";

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
  const result = await generateDailyGrid(dataset);

  return Response.json({
    ok: true,
    date: result.date,
    rowTypes: result.grid.rowTypes,
    colTypes: result.grid.colTypes,
    durationMs: Date.now() - startedAt,
  });
}