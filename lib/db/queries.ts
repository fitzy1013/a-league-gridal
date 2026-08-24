import type { SupabaseClient } from "@supabase/supabase-js";

export interface ClubRow {
  id: number;
  name: string;
  short_name: string;
  logo_url: string | null;
}

export interface PlayerRow {
  id: number;
  name: string;
  position: string | null;
  club_id: number | null;
  nationality: string | null;
  nationality_flag_url: string | null;
}

export interface PlayerClubRow {
  player_id: number;
  club_id: number;
  appearances: number | null;
  goals: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  wins: number | null;
  debut_age: number | null;
}

export interface SeasonStatRow {
  player_id: number;
  appearances: number | null;
  goals: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  clean_sheets: number | null;
  minutes: number | null;
  finals_appearances: number | null;
  finals_goals: number | null;
  own_goals: number | null;
}

export interface PlayerTitleRow {
  player_id: number;
}

export interface GridRow {
  id: string;
  date: string;
  row_type: string;
  col_type: string;
  row_values: unknown;
  col_values: unknown;
  solution: unknown;
  created_at: string;
}

export interface UserResultRow {
  user_id: string;
  grid_id: string;
  correct: number;
  total: number;
  finished_at: string;
}

const PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Fetches every row of a query, paginating past Supabase's per-request row
 * cap (1000 rows).
 */
async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`query failed: ${error.message}`);
    out.push(...((data as T[] | null) ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

export async function loadClubs(client: SupabaseClient): Promise<ClubRow[]> {
  return fetchAllRows<ClubRow>((from, to) =>
    client.from("clubs").select("id,name,short_name,logo_url").range(from, to),
  );
}

export async function loadPlayers(client: SupabaseClient): Promise<PlayerRow[]> {
  return fetchAllRows<PlayerRow>((from, to) =>
    client
      .from("players")
      .select("id,name,position,club_id,nationality,nationality_flag_url")
      .range(from, to),
  );
}

export async function loadPlayerClubs(client: SupabaseClient): Promise<PlayerClubRow[]> {
  // Prefer per-club stat columns; fall back gracefully when the
  // 0004_per_club_stats migration hasn't been applied yet.
  const withStats = await fetchPage("player_id,club_id,appearances,goals,yellow_cards,red_cards,wins,debut_age");
  if (withStats) return withStats;
  return (
    (await fetchPage("player_id,club_id,wins,debut_age"))?.map((r) => ({
      ...(r as PlayerClubRow),
      appearances: null,
      goals: null,
      yellow_cards: null,
      red_cards: null,
    })) ?? []
  );

  async function fetchPage(columns: string): Promise<PlayerClubRow[] | null> {
    try {
      return await fetchAllRows<PlayerClubRow>((from, to) =>
        client
          .from("player_clubs")
          .select(columns)
          .range(from, to) as unknown as PromiseLike<PageResult<PlayerClubRow>>,
      );
    } catch (e) {
      if (/appearances/.test(e instanceof Error ? e.message : "")) return null;
      throw e;
    }
  }
}

export async function loadAllTimeStats(client: SupabaseClient): Promise<SeasonStatRow[]> {
  // Prefer finals/own-goal columns; fall back gracefully when the
  // 0005_finals_own_goals migration hasn't been applied yet.
  const withFinals = await fetchStatPage(
    "player_id,appearances,goals,yellow_cards,red_cards,clean_sheets,minutes,finals_appearances,finals_goals,own_goals",
  );
  if (withFinals) return withFinals;
  const rows =
    (await fetchStatPage(
      "player_id,appearances,goals,yellow_cards,red_cards,clean_sheets,minutes",
    )) ?? [];
  return rows.map((r) => ({
    ...r,
    finals_appearances: null,
    finals_goals: null,
    own_goals: null,
  }));

  async function fetchStatPage(columns: string): Promise<SeasonStatRow[] | null> {
    try {
      return await fetchAllRows<SeasonStatRow>((from, to) =>
        client
          .from("player_season_stats")
          .select(columns)
          .eq("season", "all")
          .range(from, to) as unknown as PromiseLike<PageResult<SeasonStatRow>>,
      );
    } catch (e) {
      if (/finals_appearances/.test(e instanceof Error ? e.message : "")) return null;
      throw e;
    }
  }
}

export async function loadPlayerTitleCounts(client: SupabaseClient): Promise<PlayerTitleRow[]> {
  return fetchAllRows<PlayerTitleRow>((from, to) =>
    client.from("player_titles").select("player_id").range(from, to),
  );
}

/** Ids of clubs that have won at least one A-League Championship. */
export async function loadChampionClubIds(client: SupabaseClient): Promise<number[]> {
  const { data, error } = await client
    .from("club_titles")
    .select("club_id")
    .eq("title", "Championship");
  if (error) throw new Error(`load champion clubs: ${error.message}`);
  return [...new Set((data ?? []).map((r) => r.club_id))];
}

export async function getTodayGrid(
  client: SupabaseClient,
  date: string,
): Promise<GridRow | null> {
  const { data } = await client
    .from("grids")
    .select("*")
    .eq("date", date)
    .limit(1)
    .maybeSingle();
  return (data as GridRow | null) ?? null;
}

export async function getGrid(client: SupabaseClient, id: string): Promise<GridRow | null> {
  const { data } = await client
    .from("grids")
    .select("*")
    .eq("id", id)
    .limit(1)
    .maybeSingle();
  return (data as GridRow | null) ?? null;
}

export async function insertGrid(client: SupabaseClient, row: {
  date: string;
  row_type: string;
  col_type: string;
  row_values: unknown;
  col_values: unknown;
  solution: unknown;
}): Promise<GridRow | null> {
  const { data, error } = await client.from("grids").insert(row).select().single();
  if (error) throw new Error(`insert grid: ${error.message}`);
  return data as GridRow;
}

export async function searchPlayers(
  client: SupabaseClient,
  query: string,
  limit = 12,
): Promise<PlayerRow[]> {
  const { data } = await client
    .from("players")
    .select("id,name,position,club_id,nationality,nationality_flag_url")
    .ilike("name", `%${query}%`)
    .order("name")
    .limit(limit);
  return data as PlayerRow[] | null ?? [];
}

export async function getPlayer(
  client: SupabaseClient,
  id: number,
): Promise<PlayerRow | null> {
  const { data } = await client
    .from("players")
    .select("id,name,position,club_id,nationality,nationality_flag_url")
    .eq("id", id)
    .maybeSingle();
  return (data as PlayerRow | null) ?? null;
}

export async function upsertUserResult(
  client: SupabaseClient,
  result: { user_id: string; grid_id: string; correct: number; total: number },
): Promise<void> {
  const { error } = await client
    .from("user_results")
    .upsert(result, { onConflict: "user_id,grid_id" });
  if (error) throw new Error(`upsert user result: ${error.message}`);
}

export async function getUserResults(
  client: SupabaseClient,
  userId: string,
): Promise<(UserResultRow & { grids: { date: string }[] | null })[]> {
  const { data } = await client
    .from("user_results")
    .select("user_id,grid_id,correct,total,finished_at,grids(date)")
    .eq("user_id", userId)
    .order("finished_at", { ascending: false });
  return (
    (data as (UserResultRow & { grids: { date: string }[] | null })[]) ?? []
  );
}