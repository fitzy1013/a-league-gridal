import type { ClubRow, PlayerClubRow, PlayerRow, SeasonStatRow } from "../db/queries";
import { bandLabelFor, GRID_SIZE } from "./labels";
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
    nationality: new Map(),
    appearances: new Map(),
    goals: new Map(),
    red_cards: new Map(),
    titles: new Map(),
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

  for (const p of opts.players) {
    if (p.nationality) addToMembers("nationality", p.nationality, p.id);
  }

  const titleCount = new Map<number, number>();
  for (const id of opts.titlePlayerIds) {
    titleCount.set(id, (titleCount.get(id) ?? 0) + 1);
  }

  for (const s of opts.stats) {
    const appearances = s.appearances ?? 0;
    const goals = s.goals ?? 0;
    const redCards = s.red_cards ?? 0;

    const appsBand = bandLabelFor("appearances", appearances);
    if (appsBand) addToMembers("appearances", appsBand, s.player_id);

    const goalsBand = bandLabelFor("goals", goals);
    if (goalsBand) addToMembers("goals", goalsBand, s.player_id);

    const redBand = bandLabelFor("red_cards", redCards);
    if (redBand) addToMembers("red_cards", redBand, s.player_id);

    const titles = titleCount.get(s.player_id) ?? 0;
    const titlesBand = bandLabelFor("titles", titles);
    if (titlesBand) addToMembers("titles", titlesBand, s.player_id);
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

function intersection(a: Set<number>, b: Set<number>): Set<number> {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  const out = new Set<number>();
  for (const id of small) {
    if (large.has(id)) out.add(id);
  }
  return out;
}

const NON_CLUB_CATEGORIES: Category[] = [
  "nationality",
  "appearances",
  "goals",
  "red_cards",
  "titles",
];

interface Criterion {
  category: Category;
  label: string;
}

function intersectsAll(dataset: GridDataset, candidate: Criterion, others: Criterion[]): boolean {
  const c = membersOf(dataset, candidate.category, candidate.label);
  if (c.size === 0) return false;
  return others.every((o) => intersection(c, membersOf(dataset, o.category, o.label)).size > 0);
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
  for (const category of shuffle(categories, rng)) {
    const labels = shuffle(labelsFor(dataset, category), rng);
    for (const label of labels) {
      const candidate: Criterion = { category, label };
      if (intersectsAll(dataset, candidate, constraints)) {
        return candidate;
      }
    }
  }
  throw new Error("no feasible criterion");
}

export interface GenerateGridOptions {
  size?: number;
  rng?: () => number;
  /** guaranteed distinct clubs across rows + columns (>= 4 per spec) */
  minDistinctClubs?: number;
}

export function generateGrid(dataset: GridDataset, opts: GenerateGridOptions = {}): GridSpec {
  const size = opts.size ?? GRID_SIZE;
  const minDistinctClubs = opts.minDistinctClubs ?? 4;
  const rng = opts.rng ?? Math.random;
  const maxAttempts = 150;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return tryGenerate(dataset, size, minDistinctClubs, rng);
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

  // 2. Club columns: must share a player with EVERY club row, and be distinct
  //    from the row clubs so the total distinct club count stays >= 4.
  const rowClubMemberSets = rowCrits.map((c) => membersOf(dataset, "club", c.label));
  const candidates = clubIds.filter((clubId) => {
    if (rowClubs.includes(clubId)) return false;
    const set = membersOf(dataset, "club", String(clubId));
    return rowClubMemberSets.every((r) => intersection(r, set).size > 0);
  });
  if (candidates.length < kC) throw new Error("no feasible club columns");
  for (const clubId of sampleDistinct(candidates, kC, rng)) {
    colCrits.push({ category: "club", label: String(clubId) });
  }

  const distinctClubs = new Set([...rowClubs, ...colCrits.map((c) => Number(c.label))]).size;
  if (distinctClubs < minDistinctClubs) throw new Error("too few distinct clubs");

  // 3. Remaining rows (non-club categories).
  const rowCategories = sampleDistinct(NON_CLUB_CATEGORIES, size - kR, rng);
  for (const category of rowCategories) {
    const crit = pickCriterion(dataset, [category], colCrits, rng);
    rowCrits.push(crit);
  }

  // 4. Remaining columns (non-club categories) must intersect all rows.
  const colCategories = sampleDistinct(NON_CLUB_CATEGORIES, size - kC, rng);
  for (const category of colCategories) {
    const crit = pickCriterion(dataset, [category], rowCrits, rng);
    colCrits.push(crit);
  }

  // 5. Solution.
  const solution: CellSolution[] = [];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const rowSet = membersOf(dataset, rowCrits[i].category, rowCrits[i].label);
      const colSet = membersOf(dataset, colCrits[j].category, colCrits[j].label);
      const candidates = [...intersection(rowSet, colSet)];
      if (candidates.length === 0) throw new Error("empty cell");
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