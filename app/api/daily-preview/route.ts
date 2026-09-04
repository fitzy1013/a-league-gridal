import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/db/supabase-admin";
import { buildDailyCandidate, loadDailyContext, themeForDate, themeLabel } from "@/lib/grid/generate-daily";
import { todaySydneyDate, tomorrowSydneyDate } from "@/lib/dates";
import { cellAnswers } from "@/lib/grid/answers";

export const maxDuration = 60;

/**
 * Generates a daily-grid candidate WITHOUT storing it. Protected by the cron
 * secret (same as the generation route). Returns the full spec plus per-cell
 * answer counts so an admin can judge difficulty before approving it.
 */
export async function POST(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { target?: "today" | "tomorrow"; themeOverride?: Parameters<typeof buildDailyCandidate>[1] } | null;
  const target = body?.target === "today" ? "today" : "tomorrow";
  const date = target === "today" ? todaySydneyDate() : tomorrowSydneyDate();
  const theme = body?.themeOverride ?? themeForDate(date);

  const supabase = createAdminClient();
  const ctx = await loadDailyContext(supabase);
  const grid = buildDailyCandidate(ctx, theme);

  const size = grid.rowValues.length;
  const cells: { r: number; c: number; count: number; sample: string[] }[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const { ids, names } = cellAnswers(
        ctx.dataset,
        grid.rowTypes[r],
        grid.rowValues[r],
        grid.colTypes[c],
        grid.colValues[c],
      );
      cells.push({
        r,
        c,
        count: ids.size,
        sample: [...ids].slice(0, 5).map((id) => names.get(id) ?? `#${id}`),
      });
    }
  }

  return Response.json({ ok: true, grid, cells, theme, themeLabel: themeLabel(theme), date });
}
