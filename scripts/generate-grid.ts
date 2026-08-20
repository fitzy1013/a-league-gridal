import { createAdminClient } from "../lib/db/supabase-admin";
import { loadGridDataset } from "../lib/db/grid-loader";
import { generateDailyGrid } from "../lib/grid/generate-daily";

process.loadEnvFile(".env");

async function main() {
  const supabase = createAdminClient();
  const dataset = await loadGridDataset(supabase);
  const result = await generateDailyGrid(dataset);
  console.log(`generated grid for ${result.date}`);
  console.log(`rows: ${JSON.stringify(result.grid.rowValues)} (${result.grid.rowTypes.join(",")})`);
  console.log(`cols: ${JSON.stringify(result.grid.colValues)} (${result.grid.colTypes.join(",")})`);
  console.log(`solution cells: ${result.grid.solution.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});