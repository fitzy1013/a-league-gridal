import type { Config } from "@netlify/functions";
import { loadGridDataset } from "../../lib/db/grid-loader";
import { createAdminClient } from "../../lib/db/supabase-admin";
import { generateGrid } from "../../lib/grid/generator";

export const config: Config = {
  // 04:00 UTC daily (runs after scrape-stats on scrape days).
  schedule: "0 4 * * *",
};

const handler = async () => {
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

  return new Response(
    JSON.stringify({
      ok: true,
      date: today,
      rowTypes: grid.rowTypes,
      colTypes: grid.colTypes,
      durationMs: Date.now() - startedAt,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};

export default handler;