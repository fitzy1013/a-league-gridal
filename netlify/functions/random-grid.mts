import type { Config } from "@netlify/functions";
import { loadGridDataset } from "../../lib/db/grid-loader";
import { createAdminClient } from "../../lib/db/supabase-admin";
import { generateGrid } from "../../lib/grid/generator";

export const config: Config = { path: "/api/random-grid" };

const handler = async () => {
  const supabase = createAdminClient();
  const dataset = await loadGridDataset(supabase);
  const grid = generateGrid(dataset);

  return new Response(
    JSON.stringify({
      id: null,
      mode: "unlimited",
      rowTypes: grid.rowTypes,
      colTypes: grid.colTypes,
      rowValues: grid.rowValues,
      colValues: grid.colValues,
      solution: grid.solution,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};

export default handler;