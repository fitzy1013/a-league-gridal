import type { SupabaseClient } from "@supabase/supabase-js";
import { bandForLabel } from "./labels";
import type { Category } from "./types";

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
      return player?.nationality === displayLabel;
    }
    case "titles": {
      const band = bandForLabel("titles", displayLabel);
      if (!band) return false;
      const { count } = await db
        .from("player_titles")
        .select("player_id", { count: "exact", head: true })
        .eq("player_id", playerId);
      return count != null && count >= band.min && count <= band.max;
    }
    case "appearances":
    case "goals":
    case "red_cards": {
      const band = bandForLabel(category, displayLabel);
      if (!band) return false;
      const { data: stat } = await db
        .from("player_season_stats")
        .select("appearances,goals,red_cards")
        .eq("player_id", playerId)
        .eq("season", "all")
        .maybeSingle();
      if (!stat) return false;
      const value =
        category === "appearances"
          ? stat.appearances
          : category === "goals"
            ? stat.goals
            : stat.red_cards;
      return value != null && value >= band.min && value <= band.max;
    }
  }
}