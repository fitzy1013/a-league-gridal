import type { SupabaseClient } from "@supabase/supabase-js";
import { bandForLabel, positionLabels } from "./labels";
import type { BandedCategory, Category, NumericBand } from "./types";

const AWARD_TITLES: Partial<Record<Category, string>> = {
  golden_boot: "Golden Boot",
  jw_medal: "Johnny Warren Medal",
  marston_medal: "Joe Marston Medal",
};

function titleForAward(category: Category): string {
  return AWARD_TITLES[category] ?? "";
}

/** Player's tenure seasons (from player_clubs.seasons). */
async function playerSeasons(
  db: SupabaseClient,
  playerId: number,
): Promise<Map<number, Set<string>>> {
  const out = new Map<number, Set<string>>();
  const { data } = await db
    .from("player_clubs")
    .select("club_id,seasons")
    .eq("player_id", playerId);
  for (const r of data ?? []) {
    const set = new Set<string>();
    for (const s of String(r.seasons ?? "").split(",")) {
      const t = s.trim();
      if (t) set.add(t);
    }
    if (set.size > 0) out.set(r.club_id, set);
  }
  return out;
}

async function playerHasSeasonInEra(
  db: SupabaseClient,
  playerId: number,
  band: NumericBand,
): Promise<boolean> {
  const tenures = await playerSeasons(db, playerId);
  for (const seasons of tenures.values()) {
    for (const s of seasons) {
      const y = Number(s.slice(0, 4));
      if (y >= band.min && y <= band.max) return true;
    }
  }
  return false;
}

/** Number of seasons the player was registered at more than one club. */
async function midSeasonMoveCount(db: SupabaseClient, playerId: number): Promise<number> {
  const tenures = await playerSeasons(db, playerId);
  const seasonClubCount = new Map<string, number>();
  for (const set of tenures.values()) {
    for (const s of set) {
      seasonClubCount.set(s, (seasonClubCount.get(s) ?? 0) + 1);
    }
  }
  let n = 0;
  for (const [, c] of seasonClubCount) {
    if (c > 1) n++;
  }
  return n;
}

/** Longest stretch of distinct seasons at a single club. */
async function longestSingleClubStint(db: SupabaseClient, playerId: number): Promise<number> {
  const tenures = await playerSeasons(db, playerId);
  let max = 0;
  for (const set of tenures.values()) max = Math.max(max, set.size);
  return max;
}

/**
 * Server-side check of whether a player satisfies a single category + display
 * label criterion, using targeted queries (no full-dataset load).
 */
export async function playerSatisfiesCriterion(
  db: SupabaseClient,
  playerId: number,
  category: Category,
  displayLabel: string,
): Promise<boolean> {
  switch (category) {
    case "club": {
      const { data: club } = await db
        .from("clubs")
        .select("id")
        .eq("name", displayLabel)
        .maybeSingle();
      if (!club) return false;
      const { data: member } = await db
        .from("player_clubs")
        .select("appearances")
        .eq("player_id", playerId)
        .eq("club_id", club.id)
        .maybeSingle();
      return member != null && (member.appearances ?? 0) >= 1;
    }
    case "nationality": {
      const { data: player } = await db
        .from("players")
        .select("nationality")
        .eq("id", playerId)
        .maybeSingle();
      if (!player) return false;
      return (player.nationality ?? null) === displayLabel;
    }
    case "position": {
      const { data: player } = await db
        .from("players")
        .select("position")
        .eq("id", playerId)
        .maybeSingle();
      if (!player) return false;
      return positionLabels(player.position).includes(displayLabel);
    }
    case "championships": {
      const band = bandForLabel("championships", displayLabel);
      if (!band) return false;
      // Distinct Championship-winning clubs among the player's all-time clubs
      // where they made ≥1 appearance (same definition as buildDataset).
      const { data: playerClubs } = await db
        .from("player_clubs")
        .select("club_id,appearances")
        .eq("player_id", playerId);
      const clubIds = [...new Set((playerClubs ?? []).filter((r) => (r.appearances ?? 0) >= 1).map((r) => r.club_id))];
      if (clubIds.length === 0) return false;
      const { count } = await db
        .from("club_titles")
        .select("club_id", { count: "exact", head: true })
        .eq("title", "Championship")
        .in("club_id", clubIds);
      const championClubs = count ?? 0;
      return championClubs >= band.min && championClubs <= band.max;
    }
    case "clubs": {
      const band = bandForLabel("clubs", displayLabel);
      if (!band) return false;
      const { data: rows } = await db
        .from("player_clubs")
        .select("club_id,appearances")
        .eq("player_id", playerId);
      const distinct = new Set((rows ?? []).filter((r) => (r.appearances ?? 0) >= 1).map((r) => r.club_id)).size;
      return distinct >= band.min && distinct <= band.max;
    }
    case "debut_age": {
      const band = bandForLabel("debut_age", displayLabel);
      if (!band) return false;
      const { data: rows } = await db
        .from("player_clubs")
        .select("debut_age")
        .eq("player_id", playerId);
      const ages = (rows ?? [])
        .map((r) => r.debut_age)
        .filter((a): a is number => a != null);
      if (ages.length === 0) return false;
      // A player debuts once; use their earliest membership.
      const earliest = Math.min(...ages);
      return earliest >= band.min && earliest <= band.max;
    }
    case "win_pct": {
      const band = bandForLabel("win_pct", displayLabel);
      if (!band) return false;
      const { data: rows } = await db
        .from("player_clubs")
        .select("wins")
        .eq("player_id", playerId);
      const wins = (rows ?? []).reduce<number>((acc, r) => acc + (r.wins ?? 0), 0);
      const hasWinsData = (rows ?? []).some((r) => r.wins != null);
      if (!hasWinsData) return false;
      const { data: stat } = await db
        .from("player_season_stats")
        .select("appearances")
        .eq("player_id", playerId)
        .eq("season", "all")
        .maybeSingle();
      const apps = stat?.appearances ?? 0;
      if (apps === 0) return false;
      const pct = (wins / apps) * 100;
      return pct >= band.min && pct <= band.max;
    }
    case "height": {
      const band = bandForLabel("height", displayLabel);
      if (!band) return false;
      const { data: player } = await db
        .from("players")
        .select("height,name")
        .eq("id", playerId)
        .maybeSingle();
      if (!player?.height) return false;
      // Owner request: Elbasan Rashani is ignored for the tallest band.
      if (band.label === "190cm+" && /rashani/i.test(player.name)) return false;
      return player.height >= band.min && player.height <= band.max;
    }
    case "managed_by": {
      // Player was registered at a club in a season the manager coached there.
      const { data: mgrRows } = await db
        .from("manager_seasons")
        .select("club_id,season")
        .eq("manager_name", displayLabel);
      if (!mgrRows || mgrRows.length === 0) return false;
      const { data: pcRows } = await db
        .from("player_clubs")
        .select("club_id,seasons")
        .eq("player_id", playerId);
      for (const pc of pcRows ?? []) {
        const tenure = String(pc.seasons ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (
          (mgrRows as { club_id: number; season: string }[]).some(
            (m) => m.club_id === pc.club_id && tenure.includes(m.season),
          )
        ) {
          return true;
        }
      }
      return false;
    }
    case "premierships": {
      const band = bandForLabel("premierships", displayLabel);
      if (!band) return false;
      // Distinct Premiership-winning clubs among the player's all-time clubs where ≥1 game.
      const { data: pcRows } = await db
        .from("player_clubs")
        .select("club_id,appearances")
        .eq("player_id", playerId);
      const clubIds = [...new Set((pcRows ?? []).filter((r) => (r.appearances ?? 0) >= 1).map((r) => r.club_id))];
      if (clubIds.length === 0) return false;
      const { count } = await db
        .from("premiership_seasons")
        .select("club_id", { count: "exact", head: true })
        .in("club_id", clubIds);
      const n = count ?? 0;
      return n >= band.min && n <= band.max;
    }
    case "golden_boot":
    case "jw_medal":
    case "marston_medal": {
      const band = bandForLabel(category, displayLabel);
      if (!band) return false;
      const { count } = await db
        .from("player_titles")
        .select("title", { count: "exact", head: true })
        .eq("player_id", playerId)
        .eq("title", titleForAward(category));
      return (count ?? 0) >= band.min && (count ?? 0) <= band.max;
    }
    case "era": {
      const band = bandForLabel("era", displayLabel);
      if (!band) return false;
      return playerHasSeasonInEra(db, playerId, band);
    }
    case "mid_season": {
      const band = bandForLabel("mid_season", displayLabel);
      if (!band) return false;
      return (await midSeasonMoveCount(db, playerId)) >= band.min;
    }
    case "one_club_stint": {
      const band = bandForLabel("one_club_stint", displayLabel);
      if (!band) return false;
      const v = await longestSingleClubStint(db, playerId);
      return v >= band.min && v <= band.max;
    }
    case "multi_goal_game": {
      const band = bandForLabel("multi_goal_game", displayLabel);
      if (!band) return false;
      const { data: stat } = await db
        .from("player_season_stats")
        .select("most_goals_game")
        .eq("player_id", playerId)
        .eq("season", "all")
        .maybeSingle();
      const v = stat?.most_goals_game ?? 0;
      return v >= band.min && v <= band.max;
    }
    case "appearances":
    case "goals":
    case "red_cards":
    case "minutes":
    case "yellow_cards":
    case "clean_sheets":
    case "own_goals":
    case "finals_goals":
    case "finals_apps": {
      const band = bandForLabel(category, displayLabel);
      if (!band) return false;
      const { data: stat } = await db
        .from("player_season_stats")
        .select(
          "appearances,goals,yellow_cards,red_cards,clean_sheets,minutes,own_goals,finals_goals,finals_appearances",
        )
        .eq("player_id", playerId)
        .eq("season", "all")
        .maybeSingle();
      if (!stat) return false;
      // Missing stats mean the player recorded none — same convention as
      // buildDataset, which feeds `value ?? 0` into every band.
      const value =
        category === "appearances"
          ? (stat.appearances ?? 0)
          : category === "goals"
            ? (stat.goals ?? 0)
            : category === "red_cards"
              ? (stat.red_cards ?? 0)
              : category === "yellow_cards"
                ? (stat.yellow_cards ?? 0)
                : category === "clean_sheets"
                  ? (stat.clean_sheets ?? 0)
                  : category === "own_goals"
                    ? (stat.own_goals ?? 0)
                    : category === "finals_goals"
                      ? (stat.finals_goals ?? 0)
                      : category === "finals_apps"
                        ? (stat.finals_appearances ?? 0)
                        : (stat.minutes ?? 0);
      return value >= band.min && value <= band.max;
    }
  }
}

/**
 * Pair-aware Club x Stat cell check: the stat band must be met with the
 * stats recorded AT that club (e.g. 20+ goals for Melbourne Victory), not
 * career-wide. Implies club membership (the row must exist).
 */
export async function playerSatisfiesClubStatCell(
  db: SupabaseClient,
  playerId: number,
  clubName: string,
  statCategory: BandedCategory,
  statLabel: string,
): Promise<boolean> {
  const { data: club } = await db
    .from("clubs")
    .select("id")
    .eq("name", clubName)
    .maybeSingle();
  if (!club) return false;
  const { data: row } = await db
    .from("player_clubs")
    .select("appearances,goals,yellow_cards,red_cards,wins,debut_age,clean_sheets,minutes,seasons")
    .eq("player_id", playerId)
    .eq("club_id", club.id)
    .maybeSingle();
  if (!row) return false;
  if ((row.appearances ?? 0) < 1) return false;

  const band = bandForLabel(statCategory, statLabel);
  if (!band) return false;

  switch (statCategory) {
    case "debut_age":
      return (
        row.debut_age != null && row.debut_age >= band.min && row.debut_age <= band.max
      );
    case "clean_sheets": {
      if (band.label !== "Under 5" && row.clean_sheets == null) return false;
      const v = row.clean_sheets ?? 0;
      return v >= band.min && v <= band.max;
    }
    case "minutes": {
      if (band.label !== "Under 1000" && row.minutes == null) return false;
      const v = row.minutes ?? 0;
      return v >= band.min && v <= band.max;
    }
    case "championships": {
      // Overlap of tenure seasons at this club with its title-winning seasons.
      const { data: champRows } = await db
        .from("championship_seasons")
        .select("season")
        .eq("club_id", club.id);
      const winning = new Set(
        ((champRows ?? []) as { season: string }[]).map((r) => r.season),
      );
      const tenure = new Set(
        String(row.seasons ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      let overlap = 0;
      for (const s of tenure) {
        if (winning.has(s)) overlap++;
      }
      return overlap >= band.min && overlap <= band.max;
    }
    case "win_pct": {
      if (row.wins == null) return false;
      const apps = row.appearances ?? 0;
      if (apps === 0) return false;
      const pct = (row.wins / apps) * 100;
      return pct >= band.min && pct <= band.max;
    }
    case "appearances":
    case "goals":
    case "yellow_cards":
    case "red_cards": {
      const value =
        statCategory === "appearances"
          ? (row.appearances ?? 0)
          : statCategory === "goals"
            ? (row.goals ?? 0)
            : statCategory === "yellow_cards"
              ? (row.yellow_cards ?? 0)
              : (row.red_cards ?? 0);
      return value >= band.min && value <= band.max;
    }
    default:
      return false;
  }
}

const plural = (v: number) => (v === 1 ? "" : "s");

/**
 * Human-readable reveal of the player's actual value for a criterion, used to
 * teach after an incorrect guess. When clubName is given and the category is
 * pair-aware, the value is the one recorded AT that club; otherwise it is the
 * career-wide figure. Returns null when nothing meaningful can be said.
 */
export async function describeStatValue(
  db: SupabaseClient,
  playerId: number,
  playerName: string,
  category: Category,
  displayLabel: string,
  clubName?: string,
): Promise<string | null> {
  // ---- per-club values (Club x Stat cells) ----
  if (clubName) {
    const { data: club } = await db
      .from("clubs")
      .select("id")
      .eq("name", clubName)
      .maybeSingle();
    if (!club) return `${playerName} never played for ${clubName}`;
    const { data: row } = await db
      .from("player_clubs")
      .select("appearances,goals,yellow_cards,red_cards,wins,debut_age")
      .eq("player_id", playerId)
      .eq("club_id", club.id)
      .maybeSingle();
    if (!row) return `${playerName} never played for ${clubName}`;

    switch (category) {
      case "goals":
        return `${playerName} scored ${row.goals ?? 0} goal${plural(row.goals ?? 0)} for ${clubName}`;
      case "appearances":
        return `${playerName} made ${row.appearances ?? 0} appearance${plural(row.appearances ?? 0)} for ${clubName}`;
      case "yellow_cards":
        return `${playerName} received ${row.yellow_cards ?? 0} yellow card${plural(row.yellow_cards ?? 0)} for ${clubName}`;
      case "red_cards":
        return `${playerName} received ${row.red_cards ?? 0} red card${plural(row.red_cards ?? 0)} for ${clubName}`;
      case "debut_age":
        return row.debut_age != null
          ? `${playerName} debuted for ${clubName} at age ${row.debut_age}`
          : `${playerName} has no debut age recorded for ${clubName}`;
      case "win_pct": {
        const apps = row.appearances ?? 0;
        if (row.wins == null || apps === 0) {
          return `${playerName} won no games for ${clubName}`;
        }
        const pct = Math.round((row.wins / apps) * 100);
        return `${playerName} won ${row.wins} of ${apps} games (${pct}%) for ${clubName}`;
      }
      default:
        break;
    }
  }

  // ---- career-wide values ----
  switch (category) {
    case "appearances":
    case "goals":
    case "minutes":
    case "yellow_cards":
    case "red_cards":
    case "clean_sheets":
    case "own_goals":
    case "finals_goals":
    case "finals_apps":
    case "championships":
    case "clubs": {
      const { data: stat } = await db
        .from("player_season_stats")
        .select(
          "appearances,goals,yellow_cards,red_cards,clean_sheets,minutes,own_goals,finals_goals,finals_appearances",
        )
        .eq("player_id", playerId)
        .eq("season", "all")
        .maybeSingle();
      let v: number;
      switch (category) {
        case "goals": v = stat?.goals ?? 0; return `${playerName} scored ${v} A-League goal${plural(v)}`;
        case "appearances": v = stat?.appearances ?? 0; return `${playerName} made ${v} A-League appearance${plural(v)}`;
        case "minutes": v = stat?.minutes ?? 0; return `${playerName} played ${(v).toLocaleString("en-AU")} minutes`;
        case "yellow_cards": v = stat?.yellow_cards ?? 0; return `${playerName} collected ${v} yellow card${plural(v)}`;
        case "red_cards": v = stat?.red_cards ?? 0; return `${playerName} collected ${v} red card${plural(v)}`;
        case "clean_sheets": v = stat?.clean_sheets ?? 0; return `${playerName} kept ${v} clean sheet${plural(v)}`;
        case "own_goals": v = stat?.own_goals ?? 0; return `${playerName} scored ${v} own goal${plural(v)}`;
        case "finals_goals": v = stat?.finals_goals ?? 0; return `${playerName} scored ${v} goal${plural(v)} in finals`;
        case "finals_apps": v = stat?.finals_appearances ?? 0; return `${playerName} made ${v} finals appearance${plural(v)}`;
        case "championships": {
          const { data: pcRows } = await db
            .from("player_clubs")
            .select("club_id")
            .eq("player_id", playerId);
          const clubIds = [...new Set((pcRows ?? []).map((r) => r.club_id))];
          if (clubIds.length === 0) return `${playerName} played for no championship-winning clubs`;
          const { count } = await db
            .from("club_titles")
            .select("club_id", { count: "exact", head: true })
            .eq("title", "Championship")
            .in("club_id", clubIds);
          const n = count ?? 0;
          return `${playerName} played for ${n} championship-winning club${plural(n)}`;
        }
        case "clubs": {
          const { data: pcRows } = await db
            .from("player_clubs")
            .select("club_id")
            .eq("player_id", playerId);
          const n = new Set((pcRows ?? []).map((r) => r.club_id)).size;
          return `${playerName} played for ${n} A-League club${plural(n)}`;
        }
        default:
          return null;
      }
    }
    case "golden_boot":
    case "jw_medal":
    case "marston_medal": {
      const label =
        category === "golden_boot"
          ? "Golden Boot"
          : category === "jw_medal"
            ? "Johnny Warren Medal"
            : "Joe Marston Medal";
      const { count } = await db
        .from("player_titles")
        .select("title", { count: "exact", head: true })
        .eq("player_id", playerId)
        .eq("title", label);
      return `${playerName} won ${count ?? 0} ${label} award${plural(count ?? 0)}`;
    }
    case "premierships": {
      const { data: pcRows } = await db
        .from("player_clubs")
        .select("club_id")
        .eq("player_id", playerId);
      const clubIds = [...new Set((pcRows ?? []).map((r) => r.club_id))];
      if (clubIds.length === 0) return `${playerName} played for no Premiership-winning clubs`;
      const { count } = await db
        .from("premiership_seasons")
        .select("club_id", { count: "exact", head: true })
        .in("club_id", clubIds);
      return `${playerName} played for ${count ?? 0} Premiership-winning club${plural(count ?? 0)}`;
    }
    case "era": {
      const tenures = await playerSeasons(db, playerId);
      let earliest: string | null = null;
      for (const seasons of tenures.values()) {
        for (const s of seasons) {
          if (earliest === null || s < earliest) earliest = s;
        }
      }
      return earliest
        ? `${playerName}'s first A-League season was ${earliest}`
        : `${playerName} has no seasons recorded`;
    }
    case "mid_season": {
      const n = await midSeasonMoveCount(db, playerId);
      return `${playerName} changed clubs mid-season ${n} time${plural(n)}`;
    }
    case "one_club_stint": {
      const tenures = await playerSeasons(db, playerId);
      let max = 0;
      for (const set of tenures.values()) max = Math.max(max, set.size);
      return `${playerName}'s longest spell at one club was ${max} season${plural(max)}`;
    }
        case "multi_goal_game": {
          const { data: stat } = await db
            .from("player_season_stats")
            .select("most_goals_game")
            .eq("player_id", playerId)
            .eq("season", "all")
            .maybeSingle();
          const v = stat?.most_goals_game ?? 0;
          return `${playerName}'s best game returned ${v} goal${plural(v)}`;
        }
    case "win_pct": {
      const { data: stat } = await db
        .from("player_season_stats")
        .select("appearances")
        .eq("player_id", playerId)
        .eq("season", "all")
        .maybeSingle();
      const apps = stat?.appearances ?? 0;
      const { data: rows } = await db
        .from("player_clubs")
        .select("wins")
        .eq("player_id", playerId);
      const wins = (rows ?? []).reduce<number>((acc, r) => acc + (r.wins ?? 0), 0);
      if (!rows?.some((r) => r.wins != null) || apps === 0) {
        return `${playerName} has no win % recorded`;
      }
      return `${playerName} won ${Math.round((wins / apps) * 100)}% of matches`;
    }
    case "debut_age": {
      const { data: rows } = await db
        .from("player_clubs")
        .select("debut_age")
        .eq("player_id", playerId);
      const ages = (rows ?? []).map((r) => r.debut_age).filter((a): a is number => a != null);
      if (ages.length === 0) return `${playerName} has no debut age recorded`;
      return `${playerName} debuted in the A-League at age ${Math.min(...ages)}`;
    }
    case "nationality": {
      const { data: player } = await db
        .from("players")
        .select("nationality")
        .eq("id", playerId)
        .maybeSingle();
      return player?.nationality
        ? `${playerName}'s nationality is ${player.nationality}`
        : `${playerName} has no nationality recorded`;
    }
    case "position": {
      const { data: player } = await db
        .from("players")
        .select("position")
        .eq("id", playerId)
        .maybeSingle();
      const labels = positionLabels(player?.position);
      return labels.length > 0
        ? `${playerName} is classified as ${labels.join(" or ")}`
        : `${playerName} has no position recorded`;
    }
    case "managed_by": {
      const { data: mgrRows } = await db
        .from("manager_seasons")
        .select("club_id,season")
        .eq("manager_name", displayLabel);
      if (!mgrRows || mgrRows.length === 0) return null;
      const { data: pcRows } = await db
        .from("player_clubs")
        .select("club_id,seasons")
        .eq("player_id", playerId);
      for (const pc of pcRows ?? []) {
        const tenure = String(pc.seasons ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const m of mgrRows as { club_id: number; season: string }[]) {
          if (m.club_id === pc.club_id && tenure.includes(m.season)) {
            const { data: club } = await db
              .from("clubs")
              .select("name")
              .eq("id", m.club_id)
              .maybeSingle();
            return `${playerName} played under ${displayLabel} at ${club?.name ?? "that club"} (${m.season})`;
          }
        }
      }
      return `${playerName} never played under ${displayLabel}`;
    }
    default:
      return null;
  }
}
