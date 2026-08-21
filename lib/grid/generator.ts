import type { ClubRow, PlayerClubRow, PlayerRow, SeasonStatRow } from "../db/queries";
import { GRID_SIZE, NUMERIC_BANDS } from "./labels";
import type { Category, CellSolution, GridSpec } from "./types";

export interface GridPlayerView {
  id: number;
  name: string;
  position: string | null;
  club_id: number | null;
  nationality: string | null;
  flag_url: string | null;
}

export interface GridDataset {
  clubs: { id: number; name: string }[];
  players: Map<number, GridPlayerView>;
  /** category -> display label -> set of player ids that satisfy it */
  members: Record<Category, Map<string, Set<number>>>;
}

export interface BuildDatasetOptions {
  clubs: ClubRow[];
  players: PlayerRow[];
  playerClubs: PlayerClubRow[];
  /** player_season_stats rows where season = 'all' */
  stats: SeasonStatRow[];
  /** player ids that hold at least one award/title */
  titlePlayerIds: number[];
}

/**
 * Builds the in-memory membership index used by the generator and by
 * server-side guess validation.
 */
export function buildDataset(opts: BuildDatasetOptions): GridDataset {
  const members: GridDataset["members"] = {
    club: new Map(),
    appearances: new Map(),
    goals: new Map(),
    red_cards: new Map(),
    titles: new Map(),
    minutes: new Map(),
    clubs: new Map(),
  };

  const playerMap: Map<number, GridPlayerView> = new Map();
  for (const p of opts.players) {
    playerMap.set(p.id, {
      id: p.id,
      name: p.name,
      position: p.position,
      club_id: p.club_id,
      nationality: p.nationality,
      flag_url: p.nationality_flag_url,
    });
  }

  const addToMembers = (category: Category, label: string, playerId: number) => {
    let set = members[category].get(label);
    if (!set) {
      set = new Set();
      members[category].set(label, set);
    }
    set.add(playerId);
  };

  for (const pc of opts.playerClubs) {
    addToMembers("club", String(pc.club_id), pc.player_id);
  }

  const titleCount = new Map<number, number>();
  for (const id of opts.titlePlayerIds) {
    titleCount.set(id, (titleCount.get(id) ?? 0) + 1);
  }

  // Distinct clubs represented per player (one player_clubs row per club).
  const clubCounts = new Map<number, number>();
  for (const pc of opts.playerClubs) {
    clubCounts.set(pc.player_id, (clubCounts.get(pc.player_id) ?? 0) + 1);
  }

  // Players join EVERY cumulative band their value clears (e.g. a player with
  // 220 apps is in "1+", "50+", "100+" AND "200+"). This keeps the "X+"
  // labels semantically accurate for generation and validation.
  const addToBands = (
    category: Extract<
      Category,
      "appearances" | "goals" | "red_cards" | "titles" | "minutes" | "clubs"
    >,
    value: number,
    playerId: number,
  ) => {
    for (const band of NUMERIC_BANDS[category]) {
      if (value >= band.min && value <= band.max) {
        addToMembers(category, band.label, playerId);
      }
    }
  };

  for (const s of opts.stats) {
    addToBands("appearances", s.appearances ?? 0, s.player_id);
    addToBands("goals", s.goals ?? 0, s.player_id);
    addToBands("red_cards", s.red_cards ?? 0, s.player_id);
    addToBands("titles", titleCount.get(s.player_id) ?? 0, s.player_id);
    addToBands("minutes", s.minutes ?? 0, s.player_id);

    const clubCount = clubCounts.get(s.player_id) ?? 0;
    addToBands("clubs", clubCount, s.player_id);
  }

  return {
    clubs: opts.clubs.map((c) => ({ id: c.id, name: c.name })),
    players: playerMap,
    members,
  };
}

/** True if the given player satisfies a category + display label criterion. */
export function playerSatisfies(
  dataset: GridDataset,
  category: Category,
  displayLabel: string,
  playerId: number,
): boolean {
  const resolved = resolveCriterionLabel(dataset, category, displayLabel);
  if (resolved === null) return false;
  return dataset.members[category].get(resolved)?.has(playerId) ?? false;
}

/**
 * Converts a display label (club name / nationality / band label) to the
 * internal membership key. Club names are resolved via the clubs list.
 */
export function resolveCriterionLabel(
  dataset: GridDataset,
  category: Category,
  displayLabel: string,
): string | null {
  if (category === "club") {
    const club = dataset.clubs.find((c) => c.name === displayLabel);
    return club ? String(club.id) : null;
  }
  return displayLabel;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sampleDistinct<T>(pool: T[], count: number, rng: () => number): T[] {
  if (pool.length < count) throw new Error("pool too small");
  return shuffle(pool, rng).slice(0, count);
}

function pickOne<T>(pool: T[], rng: () => number): T {
  return pool[Math.floor(rng() * pool.length)];
}

function membersOf(dataset: GridDataset, category: Category, label: string): Set<number> {
  return dataset.members[category].get(label) ?? new Set<number>();
}

/**
 * Order-independent signature of a grid: the sorted list of its criteria as
 * "category:displayLabel". Two grids that differ only by row/column rotation
 * share the same signature.
 */
function gridSignature(dataset: GridDataset, rowCrits: Criterion[], colCrits: Criterion[]): string[] {
  const toDisplay = (c: Criterion): string => {
    if (c.category === "club") {
      const club = dataset.clubs.find((x) => String(x.id) === c.label);
      return club ? club.name : c.label;
    }
    return c.label;
  };
  return [...rowCrits, ...colCrits]
    .map((c) => `${c.category}:${toDisplay(c)}`)
    .sort();
}

/**
 * True when a freshly generated grid is too close to an excluded (recent) one:
 * either an exact signature match, or fewer than minDiff criteria differ.
 */
function clashesWithExcluded(
  signature: string[],
  exclude: string[],
  minDiff: number,
): boolean {
  for (const ex of exclude) {
    const exParts = ex.split("|");
    const same = signature.filter((c) => exParts.includes(c)).length;
    if (same === signature.length) return true;
    if (signature.length - same < minDiff) return true;
  }
  return false;
}

function intersection(a: Set<number>, b: Set<number>): Set<number> {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  const out = new Set<number>();
  for (const id of small) {
    if (large.has(id)) out.add(id);
  }
  return out;
}

const NON_CLUB_CATEGORIES: Category[] = [
  "appearances",
  "goals",
  "red_cards",
  "titles",
  "minutes",
  "clubs",
];

interface Criterion {
  category: Category;
  label: string;
}

/**
 * Minimum intersection size between a candidate criterion and every existing
 * constraint. 0 means the candidate is infeasible; higher is better (more
 * answers per cell).
 */
function criterionScore(dataset: GridDataset, candidate: Criterion, others: Criterion[]): number {
  const c = membersOf(dataset, candidate.category, candidate.label);
  if (c.size === 0) return 0;
  let min = Infinity;
  for (const o of others) {
    const inter = intersection(c, membersOf(dataset, o.category, o.label)).size;
    if (inter === 0) return 0;
    if (inter < min) min = inter;
  }
  return min;
}

function labelsFor(dataset: GridDataset, category: Category): string[] {
  return [...dataset.members[category].keys()];
}

function pickCriterion(
  dataset: GridDataset,
  categories: Category[],
  constraints: Criterion[],
  rng: () => number,
): Criterion {
  const candidates: { criterion: Criterion; score: number }[] = [];
  for (const category of categories) {
    for (const label of labelsFor(dataset, category)) {
      const score = criterionScore(dataset, { category, label }, constraints);
      if (score > 0) candidates.push({ criterion: { category, label }, score });
    }
  }
  if (candidates.length === 0) throw new Error("no feasible criterion");

  const ranked = shuffle(candidates, rng).sort((a, b) => b.score - a.score);
  const best = ranked[0].score;
  const pool = ranked.filter((c) => c.score >= Math.max(2, Math.floor(best * 0.6)));
  if (pool.length === 0) pool.push(ranked[0]);
  return pickOne(pool, rng).criterion;
}

export interface GenerateGridOptions {
  size?: number;
  rng?: () => number;
  /** guaranteed distinct clubs across rows + columns (>= 4 per spec) */
  minDistinctClubs?: number;
  /** max cells that have exactly one answer (default 1) */
  maxSingletonCells?: number;
  /** a cell is "good" when it has at least this many answers (default 3) */
  goodCandidateCount?: number;
  /** min cells that must be "good" (default half of the grid) */
  minGoodCells?: number;
  /** a cell is "hard" when it has at most this many answers (default 10) */
  hardCellMaxAnswers?: number;
  /** min cells that must be "hard" (default 1) */
  minHardCells?: number;
  /** sorted signatures ("category:displayLabel") of recent grids to avoid
   * repeating; the new grid must differ from each in at least minDiffCriteria
   * criteria */
  exclude?: string[];
  /** min criteria that must differ from each excluded grid (default 2) */
  minDiffCriteria?: number;
}

export const DEFAULT_HARD_CELL_MAX_ANSWERS = 10;

export function generateGrid(dataset: GridDataset, opts: GenerateGridOptions = {}): GridSpec {
  const size = opts.size ?? GRID_SIZE;
  const minDistinctClubs = opts.minDistinctClubs ?? 4;
  const maxSingletonCells = opts.maxSingletonCells ?? 1;
  const goodCandidateCount = opts.goodCandidateCount ?? 3;
  const minGoodCells = opts.minGoodCells ?? Math.ceil((size * size) / 2);
  const hardCellMaxAnswers = opts.hardCellMaxAnswers ?? DEFAULT_HARD_CELL_MAX_ANSWERS;
  const minHardCells = opts.minHardCells ?? 1;
  const exclude = opts.exclude ?? [];
  const minDiffCriteria = opts.minDiffCriteria ?? 2;
  const rng = opts.rng ?? Math.random;
  const maxAttempts = 400;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return tryGenerate(
        dataset,
        size,
        minDistinctClubs,
        maxSingletonCells,
        goodCandidateCount,
        minGoodCells,
        hardCellMaxAnswers,
        minHardCells,
        exclude,
        minDiffCriteria,
        rng,
      );
    } catch {
      // re-roll
    }
  }
  throw new Error("could not generate a feasible grid after many attempts");
}

function tryGenerate(
  dataset: GridDataset,
  size: number,
  minDistinctClubs: number,
  maxSingletonCells: number,
  goodCandidateCount: number,
  minGoodCells: number,
  hardCellMaxAnswers: number,
  minHardCells: number,
  exclude: string[],
  minDiffCriteria: number,
  rng: () => number,
): GridSpec {
  if (size < 2) throw new Error("size must be >= 2");

  const clubIds = labelsFor(dataset, "club").map((id) => Number(id));
  if (clubIds.length < minDistinctClubs) {
    throw new Error("not enough clubs with players in the dataset");
  }

  // k_r club rows, k_c club cols, k_r + k_c = 4 (guarantees >= 4 distinct clubs).
  const kR = 1 + Math.floor(rng() * Math.min(3, size - 1 + 1));
  const kC = Math.min(size, 4 - kR);

  const rowCrits: Criterion[] = [];
  const colCrits: Criterion[] = [];

  // 1. Club rows.
  const rowClubs = sampleDistinct(clubIds, kR, rng);
  for (const clubId of rowClubs) {
    rowCrits.push({ category: "club", label: String(clubId) });
  }

  // 2. Club columns: must share players with EVERY club row, be distinct from
  //    the row clubs, and be ranked by how many shared players they offer
  //    (prefers club cells with several answers, not singletons).
  const rowClubMemberSets = rowCrits.map((c) => membersOf(dataset, "club", c.label));
  const candidates = clubIds
    .filter((clubId) => !rowClubs.includes(clubId))
    .map((clubId) => {
      const set = membersOf(dataset, "club", String(clubId));
      let minShared = Infinity;
      for (const r of rowClubMemberSets) {
        const inter = intersection(r, set).size;
        if (inter === 0) {
          minShared = 0;
          break;
        }
        if (inter < minShared) minShared = inter;
      }
      return { clubId, minShared };
    })
    .filter((c) => c.minShared > 0);
  if (candidates.length < kC) throw new Error("no feasible club columns");
  const rankedClubs = shuffle(candidates, rng).sort((a, b) => b.minShared - a.minShared);
  for (const { clubId } of rankedClubs.slice(0, kC)) {
    colCrits.push({ category: "club", label: String(clubId) });
  }

  const distinctClubs = new Set([...rowClubs, ...colCrits.map((c) => Number(c.label))]).size;
  if (distinctClubs < minDistinctClubs) throw new Error("too few distinct clubs");

  // 3. Remaining rows + columns (non-club categories). appearances and
  //    minutes are too similar, so they are mutually exclusive: pick a single
  //    combined pool of distinct categories, then split it between rows/cols.
  const totalNonClub = size - kR + size - kC;
  const PAIR: Category[] = ["appearances", "minutes"];
  const OTHER: Category[] = NON_CLUB_CATEGORIES.filter((c) => !PAIR.includes(c));
  let nonClubPool: Category[] = [];
  if (totalNonClub > OTHER.length || rng() < 0.75) {
    nonClubPool.push(pickOne(PAIR, rng));
  }
  nonClubPool.push(...sampleDistinct(OTHER, totalNonClub - nonClubPool.length, rng));
  nonClubPool = shuffle(nonClubPool, rng);
  const rowCategories = nonClubPool.slice(0, size - kR);
  const colCategories = nonClubPool.slice(size - kR);
  for (const category of rowCategories) {
    const crit = pickCriterion(dataset, [category], colCrits, rng);
    rowCrits.push(crit);
  }

  // 4. Remaining columns (non-club categories) must intersect all rows.
  for (const category of colCategories) {
    const crit = pickCriterion(dataset, [category], rowCrits, rng);
    colCrits.push(crit);
  }

  // 5. Avoid repeating recent grids (exact match or too few criteria differ).
  if (exclude.length > 0) {
    const signature = gridSignature(dataset, rowCrits, colCrits);
    if (clashesWithExcluded(signature, exclude, minDiffCriteria)) {
      throw new Error("grid too similar to a recent grid");
    }
  }

  // 6. Candidate counts per cell: enforce difficulty rules.
  let singletons = 0;
  let goodCells = 0;
  let hardCells = 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const rowSet = membersOf(dataset, rowCrits[i].category, rowCrits[i].label);
      const colSet = membersOf(dataset, colCrits[j].category, colCrits[j].label);
      const n = intersection(rowSet, colSet).size;
      if (n === 0) throw new Error("empty cell");
      if (n === 1) singletons++;
      if (n >= goodCandidateCount) goodCells++;
      if (n <= hardCellMaxAnswers) hardCells++;
    }
  }
  if (singletons > maxSingletonCells) throw new Error("too many singleton cells");
  if (goodCells < minGoodCells) throw new Error("not enough well-answerable cells");
  if (hardCells < minHardCells) throw new Error("not enough hard cells");

  // 7. Solution.
  const solution: CellSolution[] = [];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const rowSet = membersOf(dataset, rowCrits[i].category, rowCrits[i].label);
      const colSet = membersOf(dataset, colCrits[j].category, colCrits[j].label);
      const candidates = [...intersection(rowSet, colSet)];
      const playerId = pickOne(candidates, rng);
      solution.push({
        rowIdx: i,
        colIdx: j,
        playerId,
        playerName: dataset.players.get(playerId)?.name,
      });
    }
  }

  const displayLabel = (c: Criterion): string => {
    if (c.category === "club") {
      const club = dataset.clubs.find((x) => String(x.id) === c.label);
      return club ? club.name : c.label;
    }
    return c.label;
  };

  return {
    rowTypes: rowCrits.map((c) => c.category),
    colTypes: colCrits.map((c) => c.category),
    rowValues: rowCrits.map(displayLabel),
    colValues: colCrits.map(displayLabel),
    solution,
  };
}