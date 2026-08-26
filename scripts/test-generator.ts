import * as fs from "node:fs";
import * as path from "node:path";
import { parseAllPlayersPage, parseGeneralPage, parsePlayerStatsPage } from "../lib/scrape/parse-players";
import { buildDataset, generateGrid, DEFAULT_HARD_CELL_MAX_ANSWERS } from "../lib/grid/generator";
import { cellAnswers } from "../lib/grid/answers";
import { ALL_TIME_SEASON, GRID_SIZE } from "../lib/grid/labels";
import type { BuildDatasetOptions } from "../lib/grid/generator";

/**
 * Builds a GridDataset from saved HTML snapshots (no database required) and
 * validates the grid generator: feasible cells, >= 3 distinct clubs, club in
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

// Club All Players pages: complete per-club membership (incl. players who
// moved clubs). club_3.html is Melbourne Victory.
const allplayers = new Map<number, ReturnType<typeof parseAllPlayersPage>>();
let mvMembers: ReturnType<typeof parseAllPlayersPage> = [];
if (fs.existsSync(path.join(dir, "club_3_allplayers.html"))) {
  mvMembers = parseAllPlayersPage(read("club_3_allplayers.html"), 3, "Melbourne Victory");
  allplayers.set(3, mvMembers);
  console.log(`club 3 allplayers parsed: ${mvMembers.length} players`);
  const fornaroli = mvMembers.find((m) => m.playerId === 946);
  if (mvMembers.length < 100 || !fornaroli) {
    console.error("FAIL: allplayers page missing players (want >=100 incl. Fornaroli 946)");
    process.exit(1);
  }
}

// Merge into the same shapes the scraper would write to the database.
const playerRows = new Map<number, { id: number; name: string; position: string | null; club_id: number | null; nationality: string | null; nationality_flag_url: string | null; height: number | null }>();
const clubs = new Map<number, { id: number; name: string; short_name: string; logo_url: string | null }>();
const stats = new Map<string, { player_id: number; appearances: number | null; goals: number | null; yellow_cards: number | null; red_cards: number | null; clean_sheets: number | null; minutes: number | null; finals_appearances: number | null; finals_goals: number | null; own_goals: number | null; most_goals_game: number | null; }>();

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
      height: null,
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

const addStat = (s: { playerId: number; appearances?: number; goals?: number; yellowCards?: number; redCards?: number; cleanSheets?: number; minutes?: number }) => {
  const key = `${s.playerId}:${ALL_TIME_SEASON}`;
  const existing = stats.get(key) ?? { player_id: s.playerId, appearances: null, goals: null, yellow_cards: null, red_cards: null, clean_sheets: null, minutes: null, finals_appearances: null, finals_goals: null, own_goals: null, most_goals_game: null };
  existing.appearances ??= s.appearances ?? null;
  existing.goals ??= s.goals ?? null;
  existing.yellow_cards ??= s.yellowCards ?? null;
  existing.red_cards ??= s.redCards ?? null;
  existing.clean_sheets ??= s.cleanSheets ?? null;
  existing.minutes ??= s.minutes ?? null;
  stats.set(key, existing);
};
for (const s of [...pa.stats, ...pg.stats, ...pb.stats, ...pc.stats]) addStat(s);

const playerClubs = new Map<
  string,
  {
    player_id: number;
    club_id: number;
    appearances: number | null;
    goals: number | null;
    yellow_cards: number | null;
    red_cards: number | null;
    wins: number | null;
    debut_age: number | null;
    clean_sheets: number | null;
    minutes: number | null;
    seasons: string | null;
  }
>();
for (const p of playerRows.values()) {
  if (p.club_id != null) {
    playerClubs.set(`${p.id}:${p.club_id}`, {
      player_id: p.id,
      club_id: p.club_id,
      appearances: null,
      goals: null,
      yellow_cards: null,
      red_cards: null,
      wins: null,
      debut_age: null,
      clean_sheets: null,
      minutes: null,
      seasons: null,
    });
  }
}
for (const row of pl) {
  for (const clubId of row.clubIds) {
    const key = `${row.playerId}:${clubId}`;
    if (!playerClubs.has(key)) {
      playerClubs.set(key, {
        player_id: row.playerId,
        club_id: clubId,
        appearances: null,
        goals: null,
        yellow_cards: null,
        red_cards: null,
        wins: null,
        debut_age: null,
        clean_sheets: null,
        minutes: null,
        seasons: null,
      });
    }
  }
}
for (const m of mvMembers) {
  const key = `${m.playerId}:${m.clubId}`;
  if (!playerClubs.has(key)) {
    playerClubs.set(key, {
      player_id: m.playerId,
      club_id: m.clubId,
      appearances: m.clubAppearances ?? null,
      goals: m.clubGoals ?? null,
      yellow_cards: m.clubYellowCards ?? null,
      red_cards: m.clubRedCards ?? null,
      wins: m.wins ?? null,
      debut_age: m.debutAge ?? null,
      clean_sheets: null,
      minutes: null,
      seasons: null,
    });
  }
  if (!playerRows.has(m.playerId)) {
    addPlayer({
      playerId: m.playerId,
      name: m.name,
      position: m.position,
      clubId: m.clubId,
      clubName: m.clubName,
      nationality: m.nationality,
      nationalityFlagUrl: m.nationalityFlagUrl,
    });
  }
}

const opts: BuildDatasetOptions = {
  clubs: [...clubs.values()],
  players: [...playerRows.values()],
  playerClubs: [...playerClubs.values()],
  stats: [...stats.values()],
  // Snapshot set has no per-club trophy cabinets, so championship criteria
  // can't be exercised from HTML fixtures.
  championClubIds: [],
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
    const cats = [...grid.rowTypes, ...grid.colTypes].filter((c) => c !== "club");
    const mutuallyExclusiveOk = !(cats.includes("appearances") && cats.includes("minutes"));
    const noDupeCategory = cats.every((c, i) => cats.indexOf(c) === i);
    const allCellsSolvable = grid.solution.length === 9 && grid.solution.every((c) => c.playerId > 0);

    let singletons = 0;
    let goodCells = 0;
    let hardCells = 0;
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cnt = cellAnswers(dataset, grid.rowTypes[r], grid.rowValues[r], grid.colTypes[c], grid.colValues[c]).ids.size;
        if (cnt === 1) singletons++;
        if (cnt >= 3) goodCells++;
        if (cnt <= DEFAULT_HARD_CELL_MAX_ANSWERS) hardCells++;
      }
    }

    if (
      !hasClubRow ||
      !hasClubCol ||
      distinctClubs.size < 3 ||
      !allCellsSolvable ||
      singletons > 1 ||
      goodCells < 5 ||
      hardCells < 1 ||
      !mutuallyExclusiveOk ||
      !noDupeCategory ||
      new Set(grid.solution.map((s) => s.playerId)).size !== grid.solution.length
    ) {
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
  const okCell = cellAnswers(
    dataset,
    grid.rowTypes[r.rowIdx],
    grid.rowValues[r.rowIdx],
    grid.colTypes[r.colIdx],
    grid.colValues[r.colIdx],
  ).ids.has(r.playerId);
  console.log(`solution player ${r.playerId} satisfies cell=${okCell}`);
  if (!okCell) failures++;
}

// every solution cell must satisfy BOTH criteria (pair-aware: club x stat
// cells are validated against the per-club stat membership).
{
  let validated = 0;
  for (let n = 0; n < 5; n++) {
    const grid = generateGrid(dataset);
    for (const sol of grid.solution) {
      const ok = cellAnswers(
        dataset,
        grid.rowTypes[sol.rowIdx],
        grid.rowValues[sol.rowIdx],
        grid.colTypes[sol.colIdx],
        grid.colValues[sol.colIdx],
      ).ids.has(sol.playerId);
      if (!ok) {
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


