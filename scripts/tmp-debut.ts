import { createAdminClient } from "../lib/db/supabase-admin";
process.loadEnvFile(".env");
async function main() {
  const db = createAdminClient();
  // Alex Grant-like journeymen: pick players with 3+ clubs
  const { data: pcs } = await db.from("player_clubs").select("player_id,club_id,debut_age").range(0, 99999);
  const { data: players } = await db.from("players").select("id,name").range(0, 99999);
  const nameOf = new Map((players ?? []).map(p => [p.id, p.name]));
  const byPlayer = new Map<number, { club_id: number; debut_age: number | null }[]>();
  for (const r of pcs ?? []) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
    byPlayer.get(r.player_id)!.push({ club_id: r.club_id, debut_age: r.debut_age });
  }
  let shown = 0;
  for (const [pid, rows] of byPlayer) {
    if (rows.length < 4 || rows.some(r => r.debut_age == null)) continue;
    const ages = new Set(rows.map(r => r.debut_age));
    if (ages.size < 2) continue;
    console.log(`${nameOf.get(pid)} (${pid}):`);
    for (const r of rows.sort((a,b)=>a.club_id-b.club_id)) {
      console.log(`   club ${r.club_id}: debuted at age ${r.debut_age}`);
    }
    if (++shown >= 5) break;
  }
}
main();
