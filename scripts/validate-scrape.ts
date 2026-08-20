import * as fs from "node:fs";
import * as path from "node:path";
import { parsePlayerStatsPage, parseGeneralPage } from "../lib/scrape/parse-players";
import { parseSquadPage } from "../lib/scrape/parse-squad";
import { parseClubTitles, parsePlayerAwards } from "../lib/scrape/parse-titles";
import { parseSelectedSeason } from "../lib/scrape/ual";

/**
 * Validates the UAL HTML parsers against saved page snapshots.
 *
 * Usage:
 *   npx tsx scripts/validate-scrape.ts <dir-with-html-snapshots>
 *
 * Snapshots expected:
 *   players_pg_current.html, players_pa_all.html, players_pb_all.html,
 *   players_pc_all.html, players_pl_all.html, achievements_all.html,
 *   achievements_pa.html, club_1.html
 */

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("Provide a directory of saved UAL HTML snapshots.");
  process.exit(1);
}

const read = (name: string) =>
  fs.readFileSync(path.join(dir, name), "utf8");

const sample = <T,>(arr: T[], n = 3): T[] => arr.slice(0, n);

let failures = 0;
const check = (label: string, ok: boolean, extra?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!ok) failures++;
};

const pg = parsePlayerStatsPage(read("players_pg_current.html"), "pg", "2025-26");
check("pg current season: players parsed", pg.players.length > 100, `rows=${pg.players.length}`);
check(
  "pg row has club + nationality",
  pg.players[0]?.clubId != null && !!pg.players[0]?.nationality,
  JSON.stringify(pg.players[0]),
);
const hasGoals = pg.stats.filter((s) => (s.goals ?? 0) > 0).length;
check("pg stats include goals", hasGoals > 10, `scorers=${hasGoals}`);
console.log("  sample:", sample(pg.players.map((p) => `${p.name} (${p.position}) @${p.clubId} ${p.nationality}`)));

const pa = parsePlayerStatsPage(read("players_pa_all.html"), "pa", "all");
check("pa all-time: full roster", pa.players.length > 1000, `rows=${pa.players.length}`);
const withApps = pa.stats.filter((s) => (s.appearances ?? 0) > 0).length;
check("pa stats include appearances", withApps > 1000, `withApps=${withApps}`);
console.log("  sample:", sample(pa.stats.filter((s) => (s.appearances ?? 0) > 50)));

const pb = parsePlayerStatsPage(read("players_pb_all.html"), "pb", "all");
check("pb all-time: bookings parsed", pb.stats.length > 500, `rows=${pb.stats.length}`);
const carded = pb.stats.filter((s) => (s.yellowCards ?? 0) > 0).length;
check("pb includes yellow cards", carded > 500, `carded=${carded}`);
console.log("  sample:", sample(pb.stats.filter((s) => (s.yellowCards ?? 0) > 30)));

const pc = parsePlayerStatsPage(read("players_pc_all.html"), "pc", "all");
check("pc all-time: clean sheets parsed", pc.stats.length > 50, `rows=${pc.stats.length}`);
const gk = pc.players.filter((p) => p.position == null).length;
check("pc has no position column (expected)", gk === pc.players.length, `noPos=${gk}`);

const pl = parseGeneralPage(read("players_pl_all.html"));
check("pl general: multi-club players", pl.length > 50, `rows=${pl.length}`);
const multi = pl.filter((p) => p.clubIds.length >= 3).length;
check("pl rows list >= 3 clubs", multi > 50, `multiClub=${multi}`);
console.log("  sample:", sample(pl.map((p) => `${p.playerId}: [${p.clubIds}]`)));

const season = parseSelectedSeason(read("players_pg_current.html"), "2025-26");
check("detects selected season", season === "2025-26", `season=${season}`);

const clubTitles = parseClubTitles(read("achievements_all.html"));
check("club titles parsed", clubTitles.length > 10, `rows=${clubTitles.length}`);
const sydney = clubTitles.filter((t) => t.clubName === "Sydney FC");
check("Sydney FC titles present", sydney.length >= 3, JSON.stringify(sydney));
console.log("  sample:", sample(clubTitles));

const awards = parsePlayerAwards(read("achievements_pa.html"));
check("player awards parsed", awards.length > 200, `rows=${awards.length}`);
const maclaren = awards.filter((t) => t.playerId === 790);
check("Maclaren awards include Golden Boot", maclaren.some((t) => t.title === "Golden Boot"), JSON.stringify(maclaren.slice(0, 3)));

const squad = parseSquadPage(read("club_1.html"), 1, "Adelaide United");
check("club squad parsed", squad.length > 10, `rows=${squad.length}`);
check("squad has position + nationality", !!squad[0]?.position && !!squad[0]?.nationality, JSON.stringify(squad[0]));
console.log("  sample:", sample(squad.map((m) => `${m.name} (${m.position}) ${m.nationality}`)));

console.log(failures === 0 ? "\nAll parser checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);