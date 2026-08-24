import { createAdminClient } from "../lib/db/supabase-admin";
import { fetchHtml } from "../lib/scrape/ual";

process.loadEnvFile(".env");

/**
 * Populates players.height from UAL's tallest/shortest statistics pages
 * (?type=pl&show=tpl / show=spl), which together list every player with a
 * known height. Players without a valid height on UAL are ignored.
 *
 * Usage: npx tsx scripts/scrape-heights.ts
 */
async function main() {
  const supabase = createAdminClient();

  const heights = new Map<number, number>();
  for (const show of ["tpl", "spl"]) {
    const html = await fetchHtml(
      `${process.env.UAL_BASE ?? "https://www.ultimatealeague.com"}/statistics/player/?type=pl&show=${show}`,
    );
    // rows: <td>player link</td><td>club</td><td>club</td><td>nationality</td><td>NN cm</td>
    const rowRe =
      /player_id=(\d+)[\s\S]*?<\/tr>/g;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html)) !== null) {
      const playerId = Number(m[1]);
      const heightMatch = m[0].match(/(\d{2,3})\s*cm/i);
      if (!heightMatch) continue;
      const height = Number(heightMatch[1]);
      if (height < 140 || height > 230) continue;
      heights.set(playerId, height);
    }
  }

  console.log(`players with a valid height: ${heights.size}`);
  const buckets = new Map<string, number>();
  for (const h of heights.values()) {
    const k = h >= 190 ? "190cm+" : h <= 170 ? "170cm-" : "171-189";
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  console.log("distribution:", [...buckets.entries()]);

  let updated = 0;
  for (const [id, height] of heights) {
    const { error } = await supabase.from("players").update({ height }).eq("id", id);
    if (error) throw new Error(`update player ${id}: ${error.message}`);
    updated++;
  }
  console.log(`updated ${updated} players`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
