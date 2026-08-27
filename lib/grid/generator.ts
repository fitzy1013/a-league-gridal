import type { ClubRow, PlayerClubRow, PlayerRow, SeasonStatRow } from "../db/queries";
import {
  GRID_SIZE,
  MIN_NATIONALITY_PLAYERS,
  NUMERIC_BANDS,
  positionLabels,
} from "./labels";
import type {
  BandedCategory,
  Category,
  CellSolution,
  GridSpec,
} from "./types";
import { isPairAwareCategory } from "./types";

export interface GridPlayerView {
  id: number;
  name: string;
  position: string | null;
  club_id: number | null;
  nationality: string | null;
  flag_url: string | null;
}

/** Internal key for a per-club stat criterion (see GridDataset.clubStatMembers). */
export function clubStatKey(clubLabel: string, category: BandedCategory, label: string): string {
  return `${clubLabel}|${category}|${label}`;
}

export interface Criterion {
  category: Category;
  label: string;
}

export interface GridDataset {
  clubs: { id: number; name: string }[];
  players: Map<number, GridPlayerView>;
  /** category -> display label -> set of player ids that satisfy it */
  members: Record<Category, Map<string, Set<number>>>;
  /**
   * Per-club stat memberships for PAIR_AWARE_CATEGORIES, keyed by
   * clubStatKey(clubId, category, band label). A player is a member when
   * their record AT THAT CLUB meets the band — e.g. "6|goals|20+" holds
   * players who scored 20+ goals for club 6.
   */
  clubStatMembers: Map<string, Set<number>>;
}

export interface BuildDatasetOptions {
  clubs: ClubRow[];
  players: PlayerRow[];
  playerClubs: PlayerClubRow[];
  /** player_season_stats rows where season = 'all' */
  stats: SeasonStatRow[];
  /** ids of clubs that have won at least one A-League Championship */
  championClubIds: number[];
  /** season-level Championship winners: club id -> winning seasons */
  championshipSeasons?: Map<number, Set<string>>;
  /** season-level Premiership winners: club id -> winning seasons */
  premiershipSeasons?: Map<number, Set<string>>;
  /** individual award rows: one per player-title pairing */
  playerAwardRows?: { player_id: number; title: string }[];
  /** manager tenures: one row per manager-club-season */
  managerSeasons?: {
    managerId: number;
    managerName: string;
    clubId: number;
    season: string;
  }[];
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
    championships: new Map(),
    minutes: new Map(),
    clubs: new Map(),
    yellow_cards: new Map(),
    clean_sheets: new Map(),
    debut_age: new Map(),
    win_pct: new Map(),
    nationality: new Map(),
    position: new Map(),
    own_goals: new Map(),
    finals_goals: new Map(),
    finals_apps: new Map(),
    height: new Map(),
    managed_by: new Map(),
    golden_boot: new Map(),
    jw_medal: new Map(),
    marston_medal: new Map(),
    premierships: new Map(),
    era: new Map(),
    mid_season: new Map(),
    one_club_stint: new Map(),
    multi_goal_game: new Map(),
  };
  const clubStatMembers = new Map<string, Set<number>>();

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
    if ((pc.appearances ?? 0) < 1) continue;
    addToMembers("club", String(pc.club_id), pc.player_id);
  }

  // Distinct clubs represented per player (one player_clubs row per club, ≥1 game).
  const clubCounts = new Map<number, number>();
  for (const pc of opts.playerClubs) {
    if ((pc.appearances ?? 0) < 1) continue;
    clubCounts.set(pc.player_id, (clubCounts.get(pc.player_id) ?? 0) + 1);
  }

  // Tenure seasons per player per club (from profile History tables).
  const tenureSeasons = new Map<number, Map<number, Set<string>>>();
  for (const pc of opts.playerClubs) {
    if (!pc.seasons) continue;
    let byClub = tenureSeasons.get(pc.player_id);
    if (!byClub) {
      byClub = new Map();
      tenureSeasons.set(pc.player_id, byClub);
    }
    let set = byClub.get(pc.club_id);
    if (!set) {
      set = new Set<string>();
      byClub.set(pc.club_id, set);
    }
    for (const s of pc.seasons.split(",")) {
      const t = s.trim();
      if (t) set.add(t);
    }
  }

  // Era / mid-season moves / longest single-club stint.
  for (const [pid, byClub] of tenureSeasons) {
    const allSeasons = new Set<string>();
    const seasonClubCount = new Map<string, number>();
    let maxStint = 0;
    for (const set of byClub.values()) {
      maxStint = Math.max(maxStint, set.size);
      for (const s of set) {
        allSeasons.add(s);
        seasonClubCount.set(s, (seasonClubCount.get(s) ?? 0) + 1);
      }
    }
    let midCount = 0;
    for (const [, n] of seasonClubCount) {
      if (n > 1) midCount++;
    }
    if (midCount > 0) addToMembers("mid_season", "2+ Clubs in One Season", pid);
    for (const band of NUMERIC_BANDS.one_club_stint) {
      if (maxStint >= band.min && maxStint <= band.max) {
        addToMembers("one_club_stint", band.label, pid);
      }
    }
    for (const band of NUMERIC_BANDS.era) {
      const inBand = [...allSeasons].some((s) => {
        const y = Number(s.slice(0, 4));
        return y >= band.min && y <= band.max;
      });
      if (inBand) addToMembers("era", band.label, pid);
    }
  }

  // Championships: distinct Championship-winning clubs among the player's
  // all-time clubs (player-level ring counts aren't published by UAL).
  // Only counts clubs where the player made ≥1 appearance.
  const championClubSet = new Set(opts.championClubIds);
  const championClubCounts = new Map<number, number>();
  for (const pc of opts.playerClubs) {
    if ((pc.appearances ?? 0) < 1) continue;
    if (!championClubSet.has(pc.club_id)) continue;
    championClubCounts.set(pc.player_id, (championClubCounts.get(pc.player_id) ?? 0) + 1);
  }

  // Premierships: same construction against Premiership-winning seasons.
  const premiershipSeasonSets = opts.premiershipSeasons ?? new Map<number, Set<string>>();
  const premiershipClubSet = new Set(premiershipSeasonSets.keys());
  const premiershipClubCounts = new Map<number, number>();
  for (const pc of opts.playerClubs) {
    if ((pc.appearances ?? 0) < 1) continue;
    if (!premiershipClubSet.has(pc.club_id)) continue;
    premiershipClubCounts.set(pc.player_id, (premiershipClubCounts.get(pc.player_id) ?? 0) + 1);
  }

  // Individual awards (Golden Boot / Johnny Warren / Joe Marston).
  const awardCountBy = new Map<string, number>(); // `${playerId}:${title}` -> count
  for (const row of opts.playerAwardRows ?? []) {
    const key = `${row.player_id}:${row.title}`;
    awardCountBy.set(key, (awardCountBy.get(key) ?? 0) + 1);
  }

  // Players join EVERY band their value falls into (e.g. a player with 220
  // apps is in "1+", "50+", "100+" AND "200+"; a player with 21 goals is in
  // "20+" and "30+" but not "Under 5"). This keeps labels semantically
  // accurate for generation and validation.
  const addToBands = (category: BandedCategory, value: number, playerId: number) => {
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
    addToBands(
      "championships",
      championClubCounts.get(s.player_id) ?? 0,
      s.player_id,
    );
    addToBands(
      "premierships",
      premiershipClubCounts.get(s.player_id) ?? 0,
      s.player_id,
    );
    addToBands("golden_boot", awardCountBy.get(`${s.player_id}:Golden Boot`) ?? 0, s.player_id);
    addToBands(
      "jw_medal",
      awardCountBy.get(`${s.player_id}:Johnny Warren Medal`) ?? 0,
      s.player_id,
    );
    addToBands(
      "marston_medal",
      awardCountBy.get(`${s.player_id}:Joe Marston Medal`) ?? 0,
      s.player_id,
    );
    addToBands("minutes", s.minutes ?? 0, s.player_id);
    addToBands("yellow_cards", s.yellow_cards ?? 0, s.player_id);
    addToBands("clean_sheets", s.clean_sheets ?? 0, s.player_id);
    addToBands("own_goals", s.own_goals ?? 0, s.player_id);
    addToBands("finals_goals", s.finals_goals ?? 0, s.player_id);
    addToBands("finals_apps", s.finals_appearances ?? 0, s.player_id);
    addToBands("multi_goal_game", s.most_goals_game ?? 0, s.player_id);

    const clubCount = clubCounts.get(s.player_id) ?? 0;
    addToBands("clubs", clubCount, s.player_id);
  }

  // Nationality + position criteria. Rare nationalities are skipped so cells
  // stay answerable. Positions are grouped: GK / Def / Mid-Fwd, with Utility
  // players qualifying for both Def and Mid/Fwd.
  const nationalityCounts = new Map<string, number>();
  for (const p of opts.players) {
    if (!p.nationality) continue;
    nationalityCounts.set(p.nationality, (nationalityCounts.get(p.nationality) ?? 0) + 1);
  }
  for (const p of opts.players) {
    if (p.nationality && (nationalityCounts.get(p.nationality) ?? 0) >= MIN_NATIONALITY_PLAYERS) {
      addToMembers("nationality", p.nationality, p.id);
    }
    for (const label of positionLabels(p.position)) {
      addToMembers("position", label, p.id);
    }
    // Height bands. Owner request: ignore Elbasan Rashani for the tallest
    // band (his listed height would otherwise spoil 190cm+ cells).
    if (p.height != null) {
      const skipTallest = /rashani/i.test(p.name);
      for (const band of NUMERIC_BANDS.height) {
        if (p.height >= band.min && p.height <= band.max) {
          if (band.label === "190cm+" && skipTallest) continue;
          addToMembers("height", band.label, p.id);
        }
      }
    }
  }

  // Managed By: a player counts under a manager when they were registered at
  // the manager's club in a season that manager was in charge there.
  if (opts.managerSeasons?.length) {
    const tenuresByClub = new Map<number, { playerId: number; seasons: Set<string> }[]>();
    for (const pc of opts.playerClubs) {
      if (!pc.seasons) continue;
      const list = tenuresByClub.get(pc.club_id) ?? [];
      list.push({
        playerId: pc.player_id,
        seasons: new Set(pc.seasons.split(",").map((s) => s.trim())),
      });
      tenuresByClub.set(pc.club_id, list);
    }
    for (const ms of opts.managerSeasons) {
      for (const t of tenuresByClub.get(ms.clubId) ?? []) {
        if (t.seasons.has(ms.season)) {
          addToMembers("managed_by", ms.managerName, t.playerId);
        }
      }
    }
  }

  // Debut age: earliest A-League debut across the player's club memberships.
  const debutAges = new Map<number, number>();
  for (const pc of opts.playerClubs) {
    if (pc.debut_age == null) continue;
    const current = debutAges.get(pc.player_id);
    debutAges.set(pc.player_id, Math.min(current ?? Infinity, pc.debut_age));
  }
  for (const [playerId, age] of debutAges) {
    addToBands("debut_age", age, playerId);
  }

  // Win percentage: total wins across memberships / all-time appearances.
  const totalWins = new Map<number, number>();
  for (const pc of opts.playerClubs) {
    if (pc.wins == null) continue;
    totalWins.set(pc.player_id, (totalWins.get(pc.player_id) ?? 0) + pc.wins);
  }
  for (const s of opts.stats) {
    const wins = totalWins.get(s.player_id);
    const apps = s.appearances ?? 0;
    if (wins == null || apps === 0) continue;
    addToBands("win_pct", (wins / apps) * 100, s.player_id);
  }

  // Per-club stat memberships for Club x Stat cells. Rows scraped from the
  // General tab only carry no per-club stats and are skipped; on rows with
  // stats present, missing individual values count as zero (same convention
  // as the career-wide bands above).
  const addClubBand = (
    clubId: number,
    category: BandedCategory,
    value: number,
    playerId: number,
  ) => {
    for (const band of NUMERIC_BANDS[category]) {
      if (value >= band.min && value <= band.max) {
        const key = clubStatKey(String(clubId), category, band.label);
        let set = clubStatMembers.get(key);
        if (!set) {
          set = new Set();
          clubStatMembers.set(key, set);
        }
        set.add(playerId);
      }
    }
  };
  for (const pc of opts.playerClubs) {
    if ((pc.appearances ?? 0) < 1) continue;
    const hasStats =
      pc.appearances != null ||
      pc.goals != null ||
      pc.yellow_cards != null ||
      pc.red_cards != null ||
      pc.wins != null ||
      pc.clean_sheets != null ||
      pc.minutes != null;
    if (!hasStats) continue;
    addClubBand(pc.club_id, "appearances", pc.appearances ?? 0, pc.player_id);
    addClubBand(pc.club_id, "goals", pc.goals ?? 0, pc.player_id);
    addClubBand(pc.club_id, "yellow_cards", pc.yellow_cards ?? 0, pc.player_id);
    addClubBand(pc.club_id, "red_cards", pc.red_cards ?? 0, pc.player_id);
    if (pc.clean_sheets != null) {
      addClubBand(pc.club_id, "clean_sheets", pc.clean_sheets, pc.player_id);
    }
    if (pc.minutes != null) {
      addClubBand(pc.club_id, "minutes", pc.minutes, pc.player_id);
    }
    if (pc.debut_age != null) {
      addClubBand(pc.club_id, "debut_age", pc.debut_age, pc.player_id);
    }
    const clubApps = pc.appearances ?? 0;
    if (pc.wins != null && clubApps > 0) {
      addClubBand(pc.club_id, "win_pct", (pc.wins / clubApps) * 100, pc.player_id);
    }
    // Championships at THIS club: overlap of the player's tenure seasons with
    // the club's championship-winning seasons.
    const champSeasons = opts.championshipSeasons?.get(pc.club_id);
    if (champSeasons && pc.seasons) {
      const overlap = pc.seasons
        .split(",")
        .filter((s) => champSeasons.has(s.trim())).length;
      addClubBand(pc.club_id, "championships", overlap, pc.player_id);
    }
    // Premierships at THIS club: same construction.
    const premSeasons = premiershipSeasonSets.get(pc.club_id);
    if (premSeasons && pc.seasons) {
      const overlap = pc.seasons
        .split(",")
        .filter((s) => premSeasons.has(s.trim())).length;
      addClubBand(pc.club_id, "premierships", overlap, pc.player_id);
    }
  }

  return {
    clubs: opts.clubs.map((c) => ({ id: c.id, name: c.name })),
    players: playerMap,
    members,
    clubStatMembers,
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
}function sampleDistinct<T>(pool: T[], count: number, rng: () => number): T[] {
  if (pool.length < count) throw new Error("pool too small");
  return shuffle(pool, rng).slice(0, count);
}

/**
 * Weighted sampling without replacement: at each step one item is drawn with
 * probability proportional to its weight (default 1 when unmapped).
 */
function weightedSampleDistinct(
  items: number[],
  weights: Map<number, number>,
  count: number,
  rng: () => number,
): number[] {
  const pool = [...items];
  const out: number[] = [];
  while (out.length < count && pool.length > 0) {
    let total = 0;
    for (const id of pool) total += Math.max(weights.get(id) ?? 1, 0);
    let r = rng() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= Math.max(weights.get(pool[idx]) ?? 1, 0);
      if (r <= 0) break;
    }
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
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

/**
 * Assigns one distinct player to every cell (a bipartite matching). Cells are
 * processed most-constrained first with shuffled candidates for variety;
 * backtracking guarantees an assignment is found whenever one exists. Returns
 * null when the cells cannot all be satisfied by unique players.
 */
function pickDistinctAssignment(cellSets: Set<number>[], rng: () => number): number[] | null {
  const order = cellSets
    .map((_, i) => i)
    .sort((a, b) => cellSets[a].size - cellSets[b].size);
  const used = new Set<number>();
  const result: (number | null)[] = new Array(cellSets.length).fill(null);

  const backtrack = (idx: number): boolean => {
    if (idx === order.length) return true;
    const cellIdx = order[idx];
    const candidates = shuffle(
      [...cellSets[cellIdx]].filter((id) => !used.has(id)),
      rng,
    );
    for (const id of candidates) {
      used.add(id);
      result[cellIdx] = id;
      if (backtrack(idx + 1)) return true;
      used.delete(id);
      result[cellIdx] = null;
    }
    return false;
  };

  return backtrack(0) ? (result as number[]) : null;
}

/**
 * Players satisfying BOTH cell criteria.
 *
 * Club x pair-aware-stat cells use the per-club stat membership (e.g.
 * "Melbourne Victory x 20+ Goals" = 20+ goals FOR Melbourne Victory). Every
 * other combination — including stat x stat and club x non-pair-aware stat —
 * is a plain career-level set intersection.
 */
function cellMembers(dataset: GridDataset, a: Criterion, b: Criterion): Set<number> {
  const clubCrit = a.category === "club" ? a : b.category === "club" ? b : null;
  const otherCrit = clubCrit === null ? null : clubCrit === a ? b : a;
  if (
    clubCrit &&
    otherCrit &&
    isPairAwareCategory(otherCrit.category)
  ) {
    return (
      dataset.clubStatMembers.get(clubStatKey(clubCrit.label, otherCrit.category as BandedCategory, otherCrit.label)) ??
      new Set<number>()
    );
  }
  return intersection(
    membersOf(dataset, a.category, a.label),
    membersOf(dataset, b.category, b.label),
  );
}

const NON_CLUB_CATEGORIES: Category[] = [
  "appearances",
  "goals",
  "red_cards",
  "championships",
  "premierships",
  "minutes",
  "clubs",
  "yellow_cards",
  "clean_sheets",
  "debut_age",
  "win_pct",
  "nationality",
  "position",
  "own_goals",
  "finals_goals",
  "finals_apps",
  "height",
  "managed_by",
  "golden_boot",
  "jw_medal",
  "marston_medal",
  "era",
  "mid_season",
  "one_club_stint",
  "multi_goal_game",];

/**
 * Category groups that are too similar to appear together in one grid; at most
 * one member per group is picked (and usually none at all).
 */
const EXCLUSIVE_GROUPS: Category[][] = [
  ["appearances", "minutes"],
  ["yellow_cards", "red_cards"],
];

/** Criteria whose player set exceeds this are deprioritised for label variety
 * (e.g. the "Australia" nationality with ~1000 players). */
const MAX_LABEL_SET_SIZE = 400;

/**
 * Legacy bands kept in NUMERIC_BANDS only so the currently-live daily grid
 * still validates. Never offered to new grids; remove entries once the live
 * grid that uses them has rotated out.
 */
const DEPRECATED_BAND_LABELS: Partial<Record<BandedCategory, string[]>> = {
  appearances: ["25+"],
  yellow_cards: ["10+"],
};

/**
 * Minimum intersection size between a candidate criterion and every existing
 * constraint. 0 means the candidate is infeasible; higher is better (more
 * answers per cell). Pair-aware: a stat criterion scored against a club uses
 * the per-club stat membership, not career-wide totals.
 */
function criterionScore(dataset: GridDataset, candidate: Criterion, others: Criterion[]): number {
  const c = membersOf(dataset, candidate.category, candidate.label);
  if (c.size === 0) return 0;
  let min = Infinity;
  for (const o of others) {
    const inter = cellMembers(dataset, candidate, o).size;
    if (inter === 0) return 0;
    if (inter < min) min = inter;
  }
  return min;
}

function labelsFor(
  dataset: GridDataset,
  category: Category,
  banned?: Set<string>,
): string[] {
  const deprecated = DEPRECATED_BAND_LABELS[category as BandedCategory];
  return [...dataset.members[category].keys()].filter(
    (label) =>
      !deprecated?.includes(label) && !(banned?.has(`${category}:${label}`) ?? false),
  );
}

function pickCriterion(
  dataset: GridDataset,
  categories: Category[],
  constraints: Criterion[],
  rng: () => number,
  mode: "diverse" | "best" = "diverse",
  banned?: Set<string>,
): Criterion | null {
  const candidates: { criterion: Criterion; score: number }[] = [];
  for (const category of categories) {
    for (const label of labelsFor(dataset, category, banned)) {
      const score = criterionScore(dataset, { category, label }, constraints);
      if (score > 0) candidates.push({ criterion: { category, label }, score });
    }
  }
  if (candidates.length === 0) return null;

  // Feasible candidates, deprioritising mega-sets (e.g. "Australia" with
  // ~1000 players) whenever alternatives exist.
  const ranked = shuffle(candidates, rng).sort((a, b) => b.score - a.score);
  const feasible = ranked.filter((c) => c.score >= 2);
  let base = feasible.length >= 2 ? feasible : ranked;
  const rightSized = base.filter(
    (c) => membersOf(dataset, c.criterion.category, c.criterion.label).size <= MAX_LABEL_SET_SIZE,
  );
  if (rightSized.length >= 2) base = rightSized;
  const best = base[0].score;
  if (mode === "best") {
    // Highest-scoring candidates only (tiny random tiebreak pool): maximises
    // the chance a niche category survives the difficulty gates.
    const topPool = base.filter((c) => c.score === best).slice(0, 3);
    return pickOne(topPool, rng).criterion;
  }
  // Wide diversity window relative to the (possibly right-sized) best.
  const pool = base.filter((c) => c.score >= Math.max(2, best * 0.4));
  if (pool.length === 0) pool.push(base[0]);
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
  /** cells with more than this many answers are "fat" / too easy (default 50) */
  fatCellMinAnswers?: number;
  /** max cells allowed to be "fat" (default 2) */
  maxFatCells?: number;
  /** sorted signatures ("category:displayLabel") of recent grids to avoid
   * repeating; the new grid must differ from each in at least minDiffCriteria
   * criteria */
  exclude?: string[];
  /** min criteria that must differ from each excluded grid (default 2) */
  minDiffCriteria?: number;
  /** club display names that may not be used at all this grid (cooldown) */
  excludeClubs?: string[];
  /** "category:label" criteria banned this grid (per-criterion rotation
   * cooldown; clubs are exempt and handled by excludeClubs) */
  excludeCriteria?: string[];
  /** min shared players a club column must have with every club row
   * (default 2; relaxes to 1 when too few candidates) */
  columnMinShared?: number;
  /** per-club selection weights keyed by club display name (default 1);
   * lower weights make a club appear less often */
  clubWeights?: Record<string, number>;
}

export const DEFAULT_HARD_CELL_MAX_ANSWERS = 10;

export function generateGrid(dataset: GridDataset, opts: GenerateGridOptions = {}): GridSpec {
  const size = opts.size ?? GRID_SIZE;
  const minDistinctClubs = opts.minDistinctClubs ?? 3;
  const maxSingletonCells = opts.maxSingletonCells ?? 1;
  const goodCandidateCount = opts.goodCandidateCount ?? 3;
  const minGoodCells = opts.minGoodCells ?? Math.ceil((size * size) / 2);
  const hardCellMaxAnswers = opts.hardCellMaxAnswers ?? DEFAULT_HARD_CELL_MAX_ANSWERS;
  const minHardCells = opts.minHardCells ?? 1;
  const fatCellMinAnswers = opts.fatCellMinAnswers ?? 50;
  const maxFatCells = opts.maxFatCells ?? 2;
  const exclude = opts.exclude ?? [];
  const minDiffCriteria = opts.minDiffCriteria ?? 2;
  const excludeClubIds = new Set(
    (opts.excludeClubs ?? [])
      .map((name) => dataset.clubs.find((c) => c.name === name)?.id)
      .filter((id): id is number => id != null),
  );
  const bannedCriteria = new Set(opts.excludeCriteria ?? []);
  const columnMinShared = opts.columnMinShared ?? 2;
  const weightsById = new Map<number, number>();
  for (const c of dataset.clubs) {
    const w = opts.clubWeights?.[c.name];
    weightsById.set(c.id, w != null && w > 0 ? w : 1);
  }
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
        fatCellMinAnswers,
        maxFatCells,
        exclude,
        minDiffCriteria,
        excludeClubIds,
        bannedCriteria,
        columnMinShared,
        weightsById,
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
  fatCellMinAnswers: number,
  maxFatCells: number,
  exclude: string[],
  minDiffCriteria: number,
  excludeClubIds: Set<number>,
  bannedCriteria: Set<string>,
  columnMinShared: number,
  weightsById: Map<number, number>,
  rng: () => number,
): GridSpec {
  if (size < 2) throw new Error("size must be >= 2");

  const availableClubIds = labelsFor(dataset, "club")
    .map((id) => Number(id))
    .filter((id) => !excludeClubIds.has(id));
  if (availableClubIds.length < minDistinctClubs) {
    throw new Error("not enough clubs with players in the dataset");
  }

  // 75% of grids feature exactly 3 distinct clubs, the rest 4 (never fewer
  // than the minDistinctClubs floor). Split between rows and columns with at
  // least one club on each axis so club x stat cells exist. Drawn below 0.75
  // because 3-club attempts survive the difficulty gates slightly more often,
  // which would otherwise skew the surviving distribution to ~80/20.
  const targetClubs = Math.max(minDistinctClubs, rng() < 0.9 ? 3 : 4);
  let kR = 1 + Math.floor(rng() * (targetClubs - 1));
  kR = Math.min(kR, size);
  const kC = Math.min(targetClubs - kR, size);

  let rowCrits: Criterion[] = [];
  let colCrits: Criterion[] = [];

  // 1. Club rows (weighted sample of the available clubs).
  const rowClubs = weightedSampleDistinct(availableClubIds, weightsById, kR, rng);
  for (const clubId of rowClubs) {
    rowCrits.push({ category: "club", label: String(clubId) });
  }

  // 2. Club columns: must share players with EVERY club row and be distinct
  //    from the row clubs. Sampled uniformly from all candidates above a
  //    shared-player floor (relaxing to 1 when needed) so no single club
  //    dominates via ranking.
  const rowClubMemberSets = rowCrits.map((c) => membersOf(dataset, "club", c.label));
  const sharedWithRows = (clubId: number): number => {
    const set = membersOf(dataset, "club", String(clubId));
    let minShared = Infinity;
    for (const r of rowClubMemberSets) {
      const inter = intersection(r, set).size;
      if (inter === 0) return 0;
      if (inter < minShared) minShared = inter;
    }
    return minShared;
  };
  const eligible = availableClubIds.filter((clubId) => !rowClubs.includes(clubId));
  let floor = columnMinShared;
  const pool = eligible.map((clubId) => ({ clubId, minShared: sharedWithRows(clubId) }));
  let viable = pool.filter((c) => c.minShared >= floor);
  while (viable.length < kC && floor > 1) {
    floor -= 1;
    viable = pool.filter((c) => c.minShared >= floor);
  }
  if (viable.length < kC) throw new Error("no feasible club columns");
  for (const clubId of weightedSampleDistinct(
    viable.map((c) => c.clubId),
    weightsById,
    kC,
    rng,
  )) {
    colCrits.push({ category: "club", label: String(clubId) });
  }

  const distinctClubs = new Set([...rowClubs, ...colCrits.map((c) => Number(c.label))]).size;
  if (distinctClubs < targetClubs) throw new Error("too few distinct clubs");

  // 3. Remaining rows + columns (non-club categories). Similar categories are
  //    mutually exclusive via EXCLUSIVE_GROUPS: pick at most one per group
  //    (75% chance), then fill the remaining slots distinctly from the rest.
  const totalNonClub = size - kR + size - kC;
  const grouped = new Set(EXCLUSIVE_GROUPS.flat());
  const OTHER: Category[] = NON_CLUB_CATEGORIES.filter((c) => !grouped.has(c));
  const nonClubPool: Category[] = [];

  // Reserve one slot for a random non-grouped category, filled with its
  // best-fitting label. Niche categories (clean_sheets, win_pct, ...) would
  // otherwise almost never survive the difficulty gates.
  const reservedCategory = pickOne(OTHER, rng);
  for (const group of EXCLUSIVE_GROUPS) {
    if (totalNonClub > OTHER.length + nonClubPool.length || rng() < 0.75) {
      nonClubPool.push(pickOne(group, rng));
    }
  }
  nonClubPool.push(
    ...sampleDistinct(
      OTHER.filter((c) => c !== reservedCategory),
      Math.max(0, totalNonClub - 1 - nonClubPool.length),
      rng,
    ),
  );
  nonClubPool.push(reservedCategory);
  // Single shuffle split disjointly: a category never appears on both axes.
  const shuffledPool = shuffle(nonClubPool, rng);
  const rowCategories = shuffledPool.slice(0, size - kR);
  const colCategories = shuffledPool.slice(size - kR);

  // Pick a criterion per slot. If the assigned category has no feasible label
  // against the current cross-axis constraints, swap in another category from
  // the leftover pool instead of failing the whole attempt (small categories
  // like clean_sheets would otherwise almost never survive).
  const pickForSlots = (
    slots: number,
    categories: Category[],
    constraints: Criterion[],
  ): Criterion[] => {
    const out: Criterion[] = [];
    let pool = [...categories];
    // Attempt the reserved category first, before intra-axis constraints
    // accumulate — niche criteria survive at much higher rates.
    const reservedFirst = pool.filter((c) => c === reservedCategory);
    pool = [...reservedFirst, ...shuffle(pool.filter((c) => c !== reservedCategory), rng)];
    for (let i = 0; i < slots; i++) {
      let chosen: Criterion | null = null;
      for (let j = 0; j < pool.length && !chosen; j++) {
        const category = pool[j];
        const crit = pickCriterion(
          dataset,
          [category],
          constraints,
          rng,
          category === reservedCategory ? "best" : "diverse",
          bannedCriteria,
        );
        if (crit) {
          chosen = crit;
          pool.splice(j, 1);
        }
      }
      if (!chosen) throw new Error("no feasible criterion for any category");
      out.push(chosen);
      constraints = [...constraints, chosen];
    }
    return out;
  };

  // Rows first (columns must intersect them), then columns.
  rowCrits.push(...pickForSlots(size - kR, rowCategories, colCrits));
  colCrits.push(...pickForSlots(size - kC, colCategories, rowCrits));

  // Clubs were appended first, so without this they would always occupy the
  // leading rows and columns. Shuffle within each axis to spread them out
  // (safe: cells are a full cross product, axis-internal order is cosmetic).
  rowCrits = shuffle(rowCrits, rng);
  colCrits = shuffle(colCrits, rng);

  // 5. Avoid repeating recent grids (exact match or too few criteria differ).
  if (exclude.length > 0) {
    const signature = gridSignature(dataset, rowCrits, colCrits);
    if (clashesWithExcluded(signature, exclude, minDiffCriteria)) {
      throw new Error("grid too similar to a recent grid");
    }
  }

  // 6. Candidate counts per cell: enforce difficulty rules.
  const cellSets: Set<number>[] = [];
  let singletons = 0;
  let goodCells = 0;
  let hardCells = 0;
  let fatCells = 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const set = cellMembers(dataset, rowCrits[i], colCrits[j]);
      cellSets.push(set);
      const n = set.size;
      if (n === 0) throw new Error("empty cell");
      if (n === 1) singletons++;
      if (n >= goodCandidateCount) goodCells++;
      if (n <= hardCellMaxAnswers) hardCells++;
      if (n > fatCellMinAnswers) fatCells++;
    }
  }
  if (singletons > maxSingletonCells) throw new Error("too many singleton cells");
  if (goodCells < minGoodCells) throw new Error("not enough well-answerable cells");
  if (hardCells < minHardCells) throw new Error("not enough hard cells");
  if (fatCells > maxFatCells) throw new Error("too many fat cells");

  // 7. Solution: one DISTINCT player per cell. Cells are matched via
  //    backtracking (most-constrained first, shuffled candidates), so grids
  //    where two cells could only ever share the same player are rejected
  //    here and the whole attempt re-rolls.
  const assignment = pickDistinctAssignment(cellSets, rng);
  if (!assignment) throw new Error("no distinct-solution assignment");
  const solution: CellSolution[] = [];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const playerId = assignment[i * size + j];
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
