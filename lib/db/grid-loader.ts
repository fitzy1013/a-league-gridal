import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDataset, type GridDataset } from "../grid/generator";
import {
  getGrid,
  loadAllTimeStats,
  loadChampionClubIds,
  loadChampionshipSeasons,
  loadClubs,
  loadManagerSeasons,
  loadPlayerClubs,
  loadPlayers,
  loadPlayerTitleCounts,
  loadPremiershipSeasons,
  type GridRow,
} from "./queries";

export { getGrid };
export type { GridRow };

/**
 * Loads every table the grid generator needs and builds the membership index.
 * Used by the scheduled/on-demand API routes (service-role client).
 */
export async function loadGridDataset(client: SupabaseClient): Promise<GridDataset> {
  const [clubs, players, playerClubs, stats, championClubIds, championshipSeasons, managerSeasons, awards, premiershipSeasons] =
    await Promise.all([
      loadClubs(client),
      loadPlayers(client),
      loadPlayerClubs(client),
      loadAllTimeStats(client),
      loadChampionClubIds(client),
      loadChampionshipSeasons(client),
      loadManagerSeasons(client),
      loadPlayerTitleCounts(client),
      loadPremiershipSeasons(client),
    ]);

  return buildDataset({
    clubs,
    players,
    playerClubs,
    stats,
    championClubIds,
    championshipSeasons,
    managerSeasons,
    playerAwardRows: awards.map((a) => ({ player_id: a.player_id, title: a.title })),
    premiershipSeasons,
  });
}