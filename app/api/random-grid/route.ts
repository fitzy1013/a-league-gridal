import { loadGridDataset } from "@/lib/db/grid-loader";
import { createAdminClient } from "@/lib/db/supabase-admin";
import { generateGrid } from "@/lib/grid/generator";

/** Generates a fresh unlimited grid on demand (not stored in the DB). */
export async function POST() {
  const supabase = createAdminClient();
  const dataset = await loadGridDataset(supabase);
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