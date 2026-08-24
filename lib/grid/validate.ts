import type { SupabaseClient } from "@supabase/supabase-js";
import { bandForLabel, positionLabels, WIN_PCT_MIN_APPEARANCES } from "./labels";
import type { BandedCategory, Category } from "./types";

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
        .select("player_id")
        .eq("player_id", playerId)
        .eq("club_id", club.id)
        .maybeSingle();
      return member != null;
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
      // (same definition as buildDataset).
      const { data: playerClubs } = await db
        .from("player_clubs")
        .select("club_id")
        .eq("player_id", playerId);
      const clubIds = [...new Set((playerClubs ?? []).map((r) => r.club_id))];
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
        .select("club_id")
        .eq("player_id", playerId);
      const distinct = new Set((rows ?? []).map((r) => r.club_id)).size;
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
      if (apps < WIN_PCT_MIN_APPEARANCES) return false;
      const pct = (wins / apps) * 100;
      return pct >= band.min && pct <= band.max;
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
    .select("appearances,goals,yellow_cards,red_cards,wins,debut_age")
    .eq("player_id", playerId)
    .eq("club_id", club.id)
    .maybeSingle();
  if (!row) return false;

  const band = bandForLabel(statCategory, statLabel);
  if (!band) return false;

  switch (statCategory) {
    case "debut_age":
      return (
        row.debut_age != null && row.debut_age >= band.min && row.debut_age <= band.max
      );
    case "win_pct": {
      if (row.wins == null) return false;
      const apps = row.appearances ?? 0;
      if (apps < WIN_PCT_MIN_APPEARANCES) return false;
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
