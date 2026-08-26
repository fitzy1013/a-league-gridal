import type { SupabaseClient } from "@supabase/supabase-js";
import { todaySydneyDate } from "../dates";

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
  height: number | null;
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
  clean_sheets: number | null;
  minutes: number | null;
  seasons: string | null;
}

export interface ChampionshipSeasonRow {
  club_id: number;
  season: string;
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
  /** 'legacy' = career-wide pairing, 'v2' = per-club stat pairing */
  ruleset?: string | null;
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
  // Prefer the height column; fall back gracefully when the
  // 0006_player_height migration hasn't been applied yet.
  const withHeight = await fetchPlayerPage("id,name,position,club_id,nationality,nationality_flag_url,height");
  if (withHeight) return withHeight;
  return (
    (await fetchPlayerPage(
      "id,name,position,club_id,nationality,nationality_flag_url",
    ))?.map((r) => ({ ...(r as PlayerRow), height: null })) ?? []
  );

  async function fetchPlayerPage(columns: string): Promise<PlayerRow[] | null> {
    try {
      return await fetchAllRows<PlayerRow>((from, to) =>
        client
          .from("players")
          .select(columns)
          .range(from, to) as unknown as PromiseLike<PageResult<PlayerRow>>,
      );
    } catch (e) {
      if (/height/.test(e instanceof Error ? e.message : "")) return null;
      throw e;
    }
  }
}

export async function loadPlayerClubs(client: SupabaseClient): Promise<PlayerClubRow[]> {
  // Prefer the full column set; fall back gracefully when later migrations
  // haven't been applied yet.
  const full = await fetchPage(
    "player_id,club_id,appearances,goals,yellow_cards,red_cards,wins,debut_age,clean_sheets,minutes,seasons",
  );
  if (full) return full;
  const mid = await fetchPage(
    "player_id,club_id,appearances,goals,yellow_cards,red_cards,wins,debut_age",
  );
  if (mid) {
    return mid.map((r) => ({
      ...r,
      clean_sheets: null,
      minutes: null,
      seasons: null,
    }));
  }
  return (
    (await fetchPage("player_id,club_id,wins,debut_age"))?.map((r) => ({
      ...(r as PlayerClubRow),
      appearances: null,
      goals: null,
      yellow_cards: null,
      red_cards: null,
      clean_sheets: null,
      minutes: null,
      seasons: null,
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
      if (/clean_sheets|seasons|appearances/.test(e instanceof Error ? e.message : "")) {
        return null;
      }
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

/** Season-level Championship winners: club_id -> winning seasons. */
export async function loadChampionshipSeasons(
  client: SupabaseClient,
): Promise<Map<number, Set<string>>> {
  const out = new Map<number, Set<string>>();
  try {
    const { data, error } = await client
      .from("championship_seasons")
      .select("club_id,season")
      .range(0, 99999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      let set = out.get(r.club_id);
      if (!set) {
        set = new Set<string>();
        out.set(r.club_id, set);
      }
      set.add(r.season);
    }
  } catch {
    // table missing pre-migration — championships stay career-level only
  }
  return out;
}

export interface ManagerSeasonRow {
  managerId: number;
  managerName: string;
  clubId: number;
  season: string;
}

/** Manager tenures: one row per manager-club-season. Empty pre-0009. */
export async function loadManagerSeasons(client: SupabaseClient): Promise<ManagerSeasonRow[]> {
  try {
    const { data, error } = await client
      .from("manager_seasons")
      .select("manager_id,manager_name,club_id,season")
      .range(0, 99999);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      managerId: r.manager_id,
      managerName: r.manager_name,
      clubId: r.club_id,
      season: r.season,
    }));
  } catch {
    return [];
  }
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

/**
 * True when today's live grid was generated under the v2 ruleset (per-club
 * stat pairing). Used to gate the rules page until the new semantics go live.
 */
export async function isTodaysGridV2(client: SupabaseClient): Promise<boolean> {
  const grid = await getTodayGrid(client, todaySydneyDate());
  return grid?.ruleset === "v2";
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