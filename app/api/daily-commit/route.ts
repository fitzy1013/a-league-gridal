import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/db/supabase-admin";
import { loadGridDataset } from "@/lib/db/grid-loader";
import { storeDailyGrid } from "@/lib/grid/generate-daily";
import { cellAnswers } from "@/lib/grid/answers";
import { todaySydneyDate, tomorrowSydneyDate } from "@/lib/dates";
import type { Category, CellSolution, GridSpec } from "@/lib/grid/types";

export const maxDuration = 60;

interface CommitBody {
  rowTypes?: Category[];
  colTypes?: Category[];
  rowValues?: string[];
  colValues?: string[];
  solution?: CellSolution[];
  /** "today" (default) or "tomorrow" — which Sydney date to publish for */
  target?: "today" | "tomorrow";
}

/**
 * Stores an admin-approved candidate as today's daily grid, overwriting
 * whatever is there. Protected by the cron secret. The payload is re-checked
 * against a freshly loaded dataset: every cell must be non-empty and no more
 * than 2 cells may exceed 50 answers.
 */
export async function POST(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CommitBody | null;
  if (
    !body ||
    !Array.isArray(body.rowTypes) ||
    !Array.isArray(body.colTypes) ||
    !Array.isArray(body.rowValues) ||
    !Array.isArray(body.colValues) ||
    !Array.isArray(body.solution) ||
    body.rowTypes.length !== body.rowValues.length ||
    body.colTypes.length !== body.colValues.length
  ) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const dataset = await loadGridDataset(supabase);

  // Re-validate against the live dataset before storing.
  const size = body.rowTypes.length;
  if (body.colTypes.length !== size || body.solution.length !== size * size) {
    return Response.json({ error: "grid shape mismatch" }, { status: 400 });
  }
  let fatCells = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const n = cellAnswers(
        dataset,
        body.rowTypes[r],
        body.rowValues[r],
        body.colTypes[c],
        body.colValues[c],
      ).ids.size;
      if (n === 0) {
        return Response.json(
          { error: `cell (${r},${c}) has no valid answers` },
          { status: 400 },
        );
      }
      if (n > 50) fatCells++;
    }
  }
  if (fatCells > 2) {
    return Response.json(
      { error: `${fatCells} cells exceed 50 answers (max 2)` },
      { status: 400 },
    );
  }

  const spec: GridSpec = {
    rowTypes: body.rowTypes,
    colTypes: body.colTypes,
    rowValues: body.rowValues,
    colValues: body.colValues,
    solution: body.solution,
  };
  const date = await storeDailyGrid(
    supabase,
    spec,
    body.target === "tomorrow" ? tomorrowSydneyDate() : todaySydneyDate(),
  );
  return Response.json({ ok: true, date });
}
