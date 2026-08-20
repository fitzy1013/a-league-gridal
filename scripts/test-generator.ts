import * as fs from "node:fs";
import * as path from "node:path";
import { parseGeneralPage, parsePlayerStatsPage } from "../lib/scrape/parse-players";
import { parsePlayerAwards } from "../lib/scrape/parse-titles";
import { buildDataset, generateGrid, playerSatisfies } from "../lib/grid/generator";
import { ALL_TIME_SEASON } from "../lib/grid/labels";
import type { BuildDatasetOptions } from "../lib/grid/generator";

/**
 * Builds a GridDataset from saved HTML snapshots (no database required) and
 * validates the grid generator: feasible cells, >= 4 distinct clubs, club in
 * both rows and columns.
 *
 * Usage:
 *   npx tsx scripts/test-generator.ts <dir-with-html-snapshots>
 */

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("Provide a directory of saved UAL HTML snapshots.");
  process.exit(1);
}
const read = (name: string) => fs.readFileSync(path.join(dir, name), "utf8");

const pa = parsePlayerStatsPage(read("players_pa_all.html"), "pa", "all");
const pg = parsePlayerStatsPage(read("players_pg_all.html"), "pg", "all");
const pb = parsePlayerStatsPage(read("players_pb_all.html"), "pb", "all");
const pc = parsePlayerStatsPage(read("players_pc_all.html"), "pc", "all");
const pl = parseGeneralPage(read("players_pl_all.html"));
const titles = parsePlayerAwards(read("achievements_pa.html"));

// Merge into the same shapes the scraper would write to the database.
const playerRows = new Map<number, { id: number; name: string; position: string | null; club_id: number | null; nationality: string | null; nationality_flag_url: string | null }>();
const clubs = new Map<number, { id: number; name: string; short_name: string; logo_url: string | null }>();
const stats = new Map<string, { player_id: number; appearances: number | null; goals: number | null; yellow_cards: number | null; red_cards: number | null; clean_sheets: number | null }>();

const addPlayer = (p: {
  playerId: number;
  name: string;
  position?: string;
  clubId?: number;
  clubName?: string;
  nationality?: string;
  nationalityFlagUrl?: string;
}) => {
  const existing = playerRows.get(p.playerId);
  if (!existing) {
    playerRows.set(p.playerId, {
      id: p.playerId,
      name: p.name,
      position: p.position ?? null,
      club_id: p.clubId ?? null,
      nationality: p.nationality ?? null,
      nationality_flag_url: p.nationalityFlagUrl ?? null,
    });
  } else {
    existing.position ??= p.position ?? null;
    existing.club_id ??= p.clubId ?? null;
    existing.nationality ??= p.nationality ?? null;
  }
  if (p.clubId && !clubs.has(p.clubId)) {
    clubs.set(p.clubId, { id: p.clubId, name: p.clubName ?? `Club ${p.clubId}`, short_name: "", logo_url: null });
  }
};

for (const p of [...pa.players, ...pg.players, ...pb.players, ...pc.players]) addPlayer(p);

const addStat = (s: { playerId: number; appearances?: number; goals?: number; yellowCards?: number; redCards?: number; cleanSheets?: number }) => {
  const key = `${s.playerId}:${ALL_TIME_SEASON}`;
  const existing = stats.get(key) ?? { player_id: s.playerId, appearances: null, goals: null, yellow_cards: null, red_cards: null, clean_sheets: null };
  existing.appearances ??= s.appearances ?? null;
  existing.goals ??= s.goals ?? null;
  existing.yellow_cards ??= s.yellowCards ?? null;
  existing.red_cards ??= s.redCards ?? null;
  existing.clean_sheets ??= s.cleanSheets ?? null;
  stats.set(key, existing);
};
for (const s of [...pa.stats, ...pg.stats, ...pb.stats, ...pc.stats]) addStat(s);

const playerClubs = new Map<string, { player_id: number; club_id: number }>();
for (const p of playerRows.values()) {
  if (p.club_id != null) playerClubs.set(`${p.id}:${p.club_id}`, { player_id: p.id, club_id: p.club_id });
}
for (const row of pl) {
  for (const clubId of row.clubIds) playerClubs.set(`${row.playerId}:${clubId}`, { player_id: row.playerId, club_id: clubId });
}

const opts: BuildDatasetOptions = {
  clubs: [...clubs.values()],
  players: [...playerRows.values()],
  playerClubs: [...playerClubs.values()],
  stats: [...stats.values()],
  titlePlayerIds: titles.map((t) => t.playerId),
};

const dataset = buildDataset(opts);
console.log(
  `dataset: ${dataset.players.size} players, ${dataset.clubs.length} clubs, ` +
    `${[...playerClubs.values()].length} club memberships`,
);

// sanity: club pairs
const clubMembers = dataset.members.club;
let sharedPairs = 0;
const clubKeys = [...clubMembers.keys()];
for (let i = 0; i < clubKeys.length; i++) {
  for (let j = i + 1; j < clubKeys.length; j++) {
    const a = clubMembers.get(clubKeys[i])!;
    const b = clubMembers.get(clubKeys[j])!;
    for (const id of a) {
      if (b.has(id)) {
        sharedPairs++;
        break;
      }
    }
  }
}
console.log(`club pairs sharing a player: ${sharedPairs}`);

let failures = 0;
let generated = 0;
for (let i = 0; i < 20; i++) {
  try {
    const grid = generateGrid(dataset);
    generated++;

    const distinctClubs = new Set<string>();
    grid.rowValues.forEach((v, idx) => {
      if (grid.rowTypes[idx] === "club") distinctClubs.add(v);
    });
    grid.colValues.forEach((v, idx) => {
      if (grid.colTypes[idx] === "club") distinctClubs.add(v);
    });

    const hasClubRow = grid.rowTypes.includes("club");
    const hasClubCol = grid.colTypes.includes("club");
    const allCellsSolvable = grid.solution.length === 9 && grid.solution.every((c) => c.playerId > 0);

    if (!hasClubRow || !hasClubCol || distinctClubs.size < 4 || !allCellsSolvable) {
      failures++;
      console.error("BAD GRID", JSON.stringify(grid, null, 2));
    }
  } catch (e) {
    failures++;
    console.error("generateGrid threw:", e instanceof Error ? e.message : e);
  }
}
console.log(`generated ${generated}/20 grids, ${failures} failures`);

// validation helper spot check
if (generated > 0) {
  const grid = generateGrid(dataset);
  const r = grid.solution[0];
  const okRow = playerSatisfies(dataset, grid.rowTypes[r.rowIdx], grid.rowValues[r.rowIdx], r.playerId);
  const okCol = playerSatisfies(dataset, grid.colTypes[r.colIdx], grid.colValues[r.colIdx], r.playerId);
  console.log(`solution player ${r.playerId} satisfies row=${okRow} col=${okCol}`);
  if (!okRow || !okCol) failures++;
}

// every solution cell must satisfy BOTH criteria.
{
  let validated = 0;
  for (let n = 0; n < 5; n++) {
    const grid = generateGrid(dataset);
    for (const sol of grid.solution) {
      const okR = playerSatisfies(dataset, grid.rowTypes[sol.rowIdx], grid.rowValues[sol.rowIdx], sol.playerId);
      const okC = playerSatisfies(dataset, grid.colTypes[sol.colIdx], grid.colValues[sol.colIdx], sol.playerId);
      if (!okR || !okC) {
        failures++;
        console.error(
          "FAIL solution cell",
          sol,
          `${grid.rowTypes[sol.rowIdx]}:${grid.rowValues[sol.rowIdx]}`,
          `${grid.colTypes[sol.colIdx]}:${grid.colValues[sol.colIdx]}`,
        );
      }
      validated++;
    }
  }
  console.log(`validated ${validated} solution cells (45 expected)`);
}

process.exit(failures === 0 ? 0 : 1);