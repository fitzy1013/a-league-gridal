import { createAdminClient } from "../lib/db/supabase-admin";
import { UAL_BASE, fetchHtml } from "../lib/scrape/ual";
import { parsePlayerHistory } from "../lib/scrape/parse-players";

process.loadEnvFile(".env");

/**
 * Crawls every player's UAL profile and aggregates their History table into
 * player_clubs: seasons (tenure), clean_sheets and minutes per club. Feeds
 * the pair-aware Clean Sheets / Minutes / Championships grid criteria.
 *
 * Resumable: only processes players whose player_clubs.seasons is still NULL.
 * Usage: npx tsx scripts/scrape-player-history.ts [concurrency=4]
 */
async function main() {
  const supabase = createAdminClient();
  const concurrency = Number(process.argv[2] ?? 4);

  // Players with any membership row lacking tenure seasons.
  const pending = new Set<number>();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("player_clubs")
      .select("player_id,seasons")
      .range(from, from + 999);
    for (const r of data ?? []) {
      if (!r.seasons) pending.add(r.player_id);
    }
    if (!data || data.length < 1000) break;
  }
  console.log(`players missing history: ${pending.size}`);
  if (pending.size === 0) return;

  let done = 0;
  let failures = 0;
  let rowsWritten = 0;

  async function flush(
    agg: Map<
      string,
      { player_id: number; club_id: number; seasons: Set<string>; minutes: number; cs: number | null }
    >,
  ) {
    for (const [key, a] of agg) {
      const { error } = await supabase
        .from("player_clubs")
        .update({
          seasons: [...a.seasons].sort().join(","),
          minutes: a.minutes,
          clean_sheets: a.cs,
        })
        .eq("player_id", a.player_id)
        .eq("club_id", a.club_id);
      if (error) throw new Error(`update ${key}: ${error.message}`);
      rowsWritten++;
    }
    agg.clear();
  }

  async function worker(queue: number[]) {
    const agg: Map<
      string,
      { player_id: number; club_id: number; seasons: Set<string>; minutes: number; cs: number | null }
    > = new Map();
    while (queue.length > 0) {
      const id = queue.shift()!;
      try {
        const html = await fetchHtml(`${UAL_BASE}/player/?player_id=${id}`);
        for (const row of parsePlayerHistory(html)) {
          for (const clubId of row.clubIds) {
            const key = `${id}:${clubId}`;
            let a = agg.get(key);
            if (!a) {
              a = { player_id: id, club_id: clubId, seasons: new Set(), minutes: 0, cs: null };
              agg.set(key, a);
            }
            a.seasons.add(row.season);
            a.minutes += row.minutes ?? 0;
            if (row.cs != null) a.cs = (a.cs ?? 0) + row.cs;
          }
        }
      } catch {
        failures++;
      }
      done++;
      if (done % 250 === 0) {
        console.log(`progress: ${done}/${pending.size}, rows written ${rowsWritten}`);
        await flush(agg);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    await flush(agg);
  }

  const queue = [...pending];
  await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));

  console.log(`done: ${done} profiles, failures ${failures}, membership rows updated ${rowsWritten}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
