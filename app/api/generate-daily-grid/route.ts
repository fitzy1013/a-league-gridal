import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/db/supabase-admin";
import { loadGridDataset } from "@/lib/db/grid-loader";
import { generateDailyGrid } from "@/lib/grid/generate-daily";
import { tomorrowSydneyDate } from "@/lib/dates";

export const maxDuration = 60;

/**
 * Pre-generates tomorrow's grid. Triggered by the Vercel cron in vercel.json
 * at 12:00 UTC (= 23:00 AEDT / 22:00 AEST, always before Sydney midnight),
 * so the grid is ready when the day rolls over. Pass ?date=YYYY-MM-DD to
 * target a specific date (defaults to tomorrow Sydney).
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? tomorrowSydneyDate();
  const supabase = createAdminClient();
  const dataset = await loadGridDataset(supabase);
  const result = await generateDailyGrid(dataset, { date });

  return Response.json({
    ok: true,
    date: result.date,
    rowTypes: result.grid.rowTypes,
    colTypes: result.grid.colTypes,
    durationMs: Date.now() - startedAt,
  });
}