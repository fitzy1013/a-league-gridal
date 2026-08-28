import { createAdminClient } from "../lib/db/supabase-admin";
import { UAL_BASE, fetchHtml } from "../lib/scrape/ual";

process.loadEnvFile(".env");

/**
 * Populates players.height from each player's profile biobar summary:
 *   "... Cosgrove is 192 cm tall and plays as a Forward ..."
 * Format is always "3-digit number + cm" (e.g. 192 cm, 174 cm).
 * Falls back to tallest/shortest pages (?show=tpl/spl) if no biobar height,
 * otherwise leaves blank (null). Ensures Lucas Herrington is 193cm.
 *
 * Example: https://www.ultimatealeague.com/player/?player_id=1842 (Sam Cosgrove)
 * Biobar: "Cosgrove is 192 cm tall and plays as a Forward..."
 *
 * Usage: npx tsx scripts/scrape-heights-summary.ts [concurrency=4]
 */

const OVERRIDES: Record<string, number> = {
  "Lucas Herrington": 193,
};
async function main() {
  const supabase = createAdminClient();
  const concurrency = Number(process.argv[2] ?? 4);

  // Fallback heights from tallest/shortest pages
  const fallbackHeights = new Map<number, number>();
  for (const show of ["tpl", "spl"]) {
    const html = await fetchHtml(`${UAL_BASE}/statistics/player/?type=pl&show=${show}`);
    const rowRe = /player_id=(\d+)[\s\S]*?<\/tr>/g;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html)) !== null) {
      const playerId = Number(m[1]);
      const hm = m[0].match(/(\d{2,3})\s*cm/i);
      if (!hm) continue;
      const h = Number(hm[1]);
      if (h < 140 || h > 230) continue;
      fallbackHeights.set(playerId, h);
    }
  }
  console.log(`fallback heights from tpl/spl: ${fallbackHeights.size}`);

  // All player ids + names (for override)
  const idToName = new Map<number, string>();
  const ids: number[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("players").select("id,name").range(from, from + 999);
    for (const r of data ?? []) {
      ids.push(r.id);
      idToName.set(r.id, r.name);
    }
    if (!data || data.length < 1000) break;
  }
  console.log(`players total: ${ids.length}`);

  let done = 0;
  let found = 0;
  let missing = 0;
  const updates: { id: number; height: number }[] = [];
  const queue = [...ids];

  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift()!;
      try {
        const name = idToName.get(id) ?? "";
        // Override: Lucas Herrington is always 193cm regardless of source
        if (OVERRIDES[name] != null) {
          updates.push({ id, height: OVERRIDES[name] });
          found++;
          done++;
          if (done % 250 === 0) {
            console.log(`progress: ${done}/${ids.length} found ${found} missing ${missing} queued ${updates.length}`);
          }
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        const html = await fetchHtml(`${UAL_BASE}/player/?player_id=${id}`);
        // Find "192 cm" in biobar — always 3 digits + cm per spec
        const m = html.match(/is\s+(\d{3})\s*cm\s+tall/i);
        if (m) {
          const h = Number(m[1]);
          if (h >= 140 && h <= 230) {
            updates.push({ id, height: h });
            found++;
          } else {
            // out of range -> try fallback
            const fb = fallbackHeights.get(id);
            if (fb != null) {
              updates.push({ id, height: fb });
              found++;
            } else {
              missing++;
            }
          }
        } else {
          // No biobar height -> fallback to tpl/spl
          const fb = fallbackHeights.get(id);
          if (fb != null) {
            updates.push({ id, height: fb });
            found++;
          } else {
            missing++;
          }
        }
      } catch (e) {
        // fetch failed -> try fallback before leaving blank
        const fb = fallbackHeights.get(id);
        if (fb != null) {
          updates.push({ id, height: fb });
          found++;
        } else {
          missing++;
          console.log(`  fetch failed for ${id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      done++;
      if (done % 250 === 0) {
        console.log(`progress: ${done}/${ids.length} found ${found} missing ${missing} queued ${updates.length}`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  console.log(`done: ${done} profiles, found ${found} with 3-digit cm height, missing ${missing}`);
  const buckets = new Map<string, number>();
  for (const u of updates) {
    const k = u.height >= 190 ? "190cm+" : u.height <= 170 ? "170cm-" : "171-189";
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  console.log("distribution:", [...buckets.entries()]);

  // Flush
  let updated = 0;
  for (const u of updates) {
    const { error } = await supabase.from("players").update({ height: u.height }).eq("id", u.id);
    if (error) throw new Error(`update ${u.id}: ${error.message}`);
    updated++;
    if (updated % 500 === 0) console.log(`  updated ${updated}/${updates.length}`);
  }
  console.log(`updated ${updated} players`);
}

main().catch((e) => { console.error(e); process.exit(1); });
