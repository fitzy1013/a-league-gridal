import { createAdminClient } from "../lib/db/supabase-admin";
import { UAL_BASE, fetchHtml } from "../lib/scrape/ual";
import { parsePlayerHeight } from "../lib/scrape/parse-players";

process.loadEnvFile(".env");

/**
 * One-off (rerunnable) crawler: visits every player's UAL profile page and
 * stores their height in players.height. Heights barely ever change, so this
 * is intentionally separate from the nightly scraper.
 *
 * Usage: npx tsx scripts/scrape-heights.ts [concurrency=4]
 */
async function main() {
  const supabase = createAdminClient();
  const concurrency = Number(process.argv[2] ?? 4);

  const ids: number[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("players").select("id,height").range(from, from + 999);
    for (const r of data ?? []) {
      if (r.height == null) ids.push(r.id);
    }
    if (!data || data.length < 1000) break;
  }
  console.log(`players missing height: ${ids.length}`);
  if (ids.length === 0) return;

  let done = 0;
  let found = 0;
  let failures = 0;
  const updates: { id: number; height: number | null }[] = [];

  async function worker(queue: number[]) {
    while (queue.length > 0) {
      const id = queue.shift()!;
      try {
        const html = await fetchHtml(`${UAL_BASE}/player/?player_id=${id}`);
        const height = parsePlayerHeight(html);
        updates.push({ id, height });
        if (height != null) found++;
      } catch {
        failures++;
      }
      done++;
      if (done % 250 === 0) {
        console.log(`progress: ${done}/${ids.length} fetched, ${found} heights found`);
        // flush in batches so a crash doesn't lose everything
        await flush();
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  async function flush() {
    for (const u of updates.splice(0)) {
      const { error } = await supabase.from("players").update({ height: u.height }).eq("id", u.id);
      if (error) throw new Error(`update player ${u.id}: ${error.message}`);
    }
  }

  const queue = [...ids];
  await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));
  await flush();

  console.log(`done: ${done} pages, ${found} heights stored, ${failures} fetch failures`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
