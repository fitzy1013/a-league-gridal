import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDataset, type GridDataset } from "../grid/generator";
import {
  getGrid,
  loadAllTimeStats,
  loadClubs,
  loadPlayerClubs,
  loadPlayers,
  loadPlayerTitleCounts,
  type GridRow,
} from "./queries";

export { getGrid };
export type { GridRow };

/**
 * Loads every table the grid generator needs and builds the membership index.
 * Used by the scheduled/on-demand Netlify functions (service-role client).
 */
export async function loadGridDataset(client: SupabaseClient): Promise<GridDataset> {
  const [clubs, players, playerClubs, stats, titles] = await Promise.all([
    loadClubs(client),
    loadPlayers(client),
    loadPlayerClubs(client),
    loadAllTimeStats(client),
    loadPlayerTitleCounts(client),
  ]);

  return buildDataset({
    clubs,
    players,
    playerClubs,
    stats,
    titlePlayerIds: titles.map((t) => t.player_id),
  });
}