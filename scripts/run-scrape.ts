import { createAdminClient } from "../lib/db/supabase-admin";
import { runScrape } from "../lib/scrape/run-scrape";

process.loadEnvFile(".env");

async function verifyCounts() {
  const supabase = createAdminClient();
  for (const table of [
    "clubs",
    "players",
    "player_season_stats",
    "player_clubs",
    "player_titles",
    "club_titles",
    "grids",
  ]) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) {
      console.log(`${table}: ERROR ${error.message}`);
    } else {
      console.log(`${table}: ${count}`);
    }
  }
}

async function main() {
  console.log("running scraper…");
  const result = await runScrape();
  for (const line of result.log) console.log(`  ${line}`);
  if (!result.ok) {
    console.error("scrape failed");
    process.exit(1);
  }
  console.log("DB row counts:");
  await verifyCounts();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});