import { createAdminClient } from "../lib/db/supabase-admin";
import { UAL_BASE, fetchHtml } from "../lib/scrape/ual";
import { parseManagerSeasons } from "../lib/scrape/parse-players";

process.loadEnvFile(".env");

/**
 * Crawls every manager listed on statistics/manager/?show=mgm, parses their
 * profile tenure table, and rebuilds manager_seasons. Rerunnable.
 *
 * Usage: npx tsx scripts/scrape-managers.ts
 */
async function main() {
  const supabase = createAdminClient();

  const listHtml = await fetchHtml(`${UAL_BASE}/statistics/manager/?show=mgm`);
  const ids = [
    ...new Set([...listHtml.matchAll(/manager_id=(\d+)/g)].map((m) => Number(m[1]))),
  ];
  console.log(`managers found: ${ids.length}`);

  const rows: {
    manager_id: number;
    manager_name: string;
    club_id: number;
    season: string;
  }[] = [];
  let failures = 0;

  for (const id of ids) {
    try {
      const html = await fetchHtml(`${UAL_BASE}/manager/?manager_id=${id}`);
      for (const r of parseManagerSeasons(html, id)) {
        rows.push({
          manager_id: r.managerId,
          manager_name: r.managerName,
          club_id: r.clubId,
          season: r.season,
        });
      }
    } catch {
      failures++;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const unique = new Map(
    rows.map((r) => [`${r.manager_id}:${r.club_id}:${r.season}`, r]),
  );
  console.log(`tenure rows: ${unique.size}, failures: ${failures}`);

  const { error: delErr } = await supabase
    .from("manager_seasons")
    .delete()
    .neq("manager_id", 0);
  if (delErr) throw new Error(`clear manager_seasons: ${delErr.message}`);

  const values = [...unique.values()];
  for (let i = 0; i < values.length; i += 500) {
    const { error } = await supabase
      .from("manager_seasons")
      .insert(values.slice(i, i + 500));
    if (error) throw new Error(`insert manager_seasons: ${error.message}`);
  }
  console.log(`inserted ${values.length} rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
