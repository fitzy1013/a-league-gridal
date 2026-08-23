import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDataset, type GridDataset } from "../grid/generator";
import {
  getGrid,
  loadAllTimeStats,
  loadChampionClubIds,
  loadClubs,
  loadPlayerClubs,
  loadPlayers,
  type GridRow,
} from "./queries";

export { getGrid };
export type { GridRow };

/**
 * Loads every table the grid generator needs and builds the membership index.
 * Used by the scheduled/on-demand API routes (service-role client).
 */
export async function loadGridDataset(client: SupabaseClient): Promise<GridDataset> {
  const [clubs, players, playerClubs, stats, championClubIds] = await Promise.all([
    loadClubs(client),
    loadPlayers(client),
    loadPlayerClubs(client),
    loadAllTimeStats(client),
    loadChampionClubIds(client),
  ]);

  return buildDataset({
    clubs,
    players,
    playerClubs,
    stats,
    championClubIds,
  });
}