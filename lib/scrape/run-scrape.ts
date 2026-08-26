import { createAdminClient } from "../db/supabase-admin";
import {
  parseAllPlayersPage,
  parseChampionshipSeasons,
  parseGeneralPage,
  parsePlayerStatsPage,
  parseSingleValueStats,
} from "./parse-players";
import { parseClubTitles, parsePlayerAwards } from "./parse-titles";
import {
  achievementsUrl,
  CLUBS,
  clubAllPlayersUrl,
  fetchHtml,
  generalStatsUrl,
  playerAwardsUrl,
  playerStatsShowUrl,
  playerStatsUrl,
  parseSelectedSeason,
} from "./ual";
import type { ParsedPlayerRow, ParsedSeasonStats } from "./types";

export const CURRENT_SEASON_FALLBACK = "2025-26";

export interface ScrapeResult {
  ok: boolean;
  log: string[];
}

/**
 * Scrapes Ultimate A-League and upserts clubs, players, stats, club history,
 * and achievements. Used by /api/scrape-stats (Vercel cron) and by the
 * scripts/run-scrape.ts CLI.
 */
export async function runScrape(): Promise<ScrapeResult> {
  const startedAt = Date.now();
  const supabase = createAdminClient();
  const log: string[] = [];

  // 1. Clubs ------------------------------------------------------------------
  await supabase.from("clubs").upsert(
    CLUBS.map((c) => ({ ...c, updated_at: new Date().toISOString() })),
    { onConflict: "id" },
  );
  log.push(`clubs: ${CLUBS.length}`);

  // 2. Detect the current season from a stats page -----------------------------
  const probeHtml = await fetchHtml(playerStatsUrl("pa", "all"));
  const currentSeason = parseSelectedSeason(probeHtml, CURRENT_SEASON_FALLBACK);

  // 3. Player stats pages (all-time + current season) --------------------------
  const playerMap = new Map<number, ParsedPlayerRow>();
  const statsMap = new Map<string, ParsedSeasonStats>();

  const mergePage = (page: { players: ParsedPlayerRow[]; stats: ParsedSeasonStats[] }) => {
    for (const p of page.players) {
      const existing = playerMap.get(p.playerId);
      if (!existing) {
        playerMap.set(p.playerId, p);
      } else {
        existing.position ??= p.position;
        existing.clubId ??= p.clubId;
        existing.clubName ??= p.clubName;
        existing.nationality ??= p.nationality;
        existing.nationalityFlagUrl ??= p.nationalityFlagUrl;
      }
    }
    for (const s of page.stats) {
      const key = `${s.playerId}:${s.season}`;
      const existing = statsMap.get(key);
      if (!existing) {
        statsMap.set(key, { ...s });
      } else {
        existing.appearances ??= s.appearances;
        existing.goals ??= s.goals;
        existing.yellowCards ??= s.yellowCards;
        existing.redCards ??= s.redCards;
        existing.cleanSheets ??= s.cleanSheets;
      }
    }
  };

  for (const type of ["pa", "pg", "pb", "pc"] as const) {
    for (const season of ["all", currentSeason]) {
      const html = await fetchHtml(playerStatsUrl(type, season));
      mergePage(parsePlayerStatsPage(html, type, season));
    }
  }
  log.push(`players: ${playerMap.size}, stats: ${statsMap.size}`);

  // 3b. Single-value "Show" pages -> finals appearances / finals goals /
  //     own goals, merged into the season='all' stat rows.
  const applyShowStat = (key: string, page: string) => {
    for (const { playerId, value } of parseSingleValueStats(page)) {
      let existing = statsMap.get(`${playerId}:all`);
      if (!existing) {
        existing = { playerId, season: "all" };
        statsMap.set(existing.playerId + ":all", existing);
      }
      if (key === "finalsAppearances") existing.finalsAppearances ??= value;
      else if (key === "finalsGoals") existing.finalsGoals ??= value;
      else if (key === "mostGoalsGame") existing.mostGoalsGame ??= value;
      else existing.ownGoals ??= value;
    }
  };
  applyShowStat("finalsAppearances", await fetchHtml(playerStatsShowUrl("pa", "fin")));
  applyShowStat("finalsGoals", await fetchHtml(playerStatsShowUrl("pg", "fin")));
  applyShowStat("ownGoals", await fetchHtml(playerStatsShowUrl("pg", "og")));
  applyShowStat("mostGoalsGame", await fetchHtml(playerStatsShowUrl("pg", "sg")));

  // 4. General tab: multi-club history (all-time) ------------------------------
  const general = parseGeneralPage(await fetchHtml(generalStatsUrl("all")));
  log.push(`multi-club players: ${general.length}`);

  // 5. Club All Players pages: complete all-time membership --------------------
  let membershipCount = 0;
  const membership = new Map<
    string,
    {
      player_id: number;
      club_id: number;
      appearances: number | null;
      goals: number | null;
      yellow_cards: number | null;
      red_cards: number | null;
      wins: number | null;
      debut_age: number | null;
    }
  >();
  for (const club of CLUBS) {
    const html = await fetchHtml(clubAllPlayersUrl(club.id));
    for (const m of parseAllPlayersPage(html, club.id, club.name)) {
      membershipCount++;
      membership.set(`${m.playerId}:${m.clubId}`, {
        player_id: m.playerId,
        club_id: m.clubId,
        appearances: m.clubAppearances ?? null,
        goals: m.clubGoals ?? null,
        yellow_cards: m.clubYellowCards ?? null,
        red_cards: m.clubRedCards ?? null,
        wins: m.wins ?? null,
        debut_age: m.debutAge ?? null,
      });
      const existing = playerMap.get(m.playerId);
      if (!existing) {
        playerMap.set(m.playerId, {
          playerId: m.playerId,
          name: m.name,
          position: m.position,
          clubId: m.clubId,
          clubName: m.clubName,
          nationality: m.nationality,
          nationalityFlagUrl: m.nationalityFlagUrl,
        });
      } else {
        existing.position ??= m.position;
        existing.nationality ??= m.nationality;
        existing.nationalityFlagUrl ??= m.nationalityFlagUrl;
      }
    }
  }
  log.push(`club membership rows parsed: ${membershipCount}`);

  // 6. Achievements: club titles + player awards -------------------------------
  const clubTitles = parseClubTitles(await fetchHtml(achievementsUrl()));
  const playerTitles = parsePlayerAwards(await fetchHtml(playerAwardsUrl()));
  log.push(`club titles: ${clubTitles.length}, player titles: ${playerTitles.length}`);

  // 7. Upserts -----------------------------------------------------------------
  const now = new Date().toISOString();
  await upsertChunked(supabase, "players", [...playerMap.values()].map((p) => ({
    id: p.playerId,
    name: p.name,
    position: p.position ?? null,
    club_id: p.clubId ?? null,
    nationality: p.nationality ?? null,
    nationality_flag_url: p.nationalityFlagUrl ?? null,
    updated_at: now,
  })), "id");

  await upsertChunked(supabase, "player_season_stats", [...statsMap.values()].map((s) => ({
    player_id: s.playerId,
    season: s.season,
    appearances: s.appearances ?? null,
    goals: s.goals ?? null,
    assists: null,
    yellow_cards: s.yellowCards ?? null,
    red_cards: s.redCards ?? null,
    clean_sheets: s.cleanSheets ?? null,
    minutes: s.minutes ?? null,
    finals_appearances: s.finalsAppearances ?? null,
    finals_goals: s.finalsGoals ?? null,
    own_goals: s.ownGoals ?? null,
    most_goals_game: s.mostGoalsGame ?? null,
    updated_at: now,
  })), "player_id,season");

  // player_clubs: full all-time membership from each club's All Players page,
  // plus multi-club history from the General tab.
  const clubRows = new Map<
    string,
    {
      player_id: number;
      club_id: number;
      appearances: number | null;
      goals: number | null;
      yellow_cards: number | null;
      red_cards: number | null;
      wins: number | null;
      debut_age: number | null;
    }
  >();
  for (const [key, row] of membership) {
    clubRows.set(key, row);
  }
  for (const pc of general) {
    for (const clubId of pc.clubIds) {
      const key = `${pc.playerId}:${clubId}`;
      if (!clubRows.has(key)) {
        clubRows.set(key, {
          player_id: pc.playerId,
          club_id: clubId,
          appearances: null,
          goals: null,
          yellow_cards: null,
          red_cards: null,
          wins: null,
          debut_age: null,
        });
      }
    }
  }
  const { error: delErr } = await supabase.from("player_clubs").delete().neq("player_id", 0);
  if (delErr) throw new Error(`clear player_clubs: ${delErr.message}`);
  await upsertChunked(supabase, "player_clubs", [...clubRows.values()], "player_id,club_id");

  await upsertChunked(supabase, "player_titles", playerTitles.map((t) => ({
    player_id: t.playerId,
    title: t.title,
    season: t.season,
    count: 1,
  })), "player_id,title,season");

  await upsertChunked(supabase, "club_titles", clubTitles.map((t) => ({
    club_id: t.clubId,
    title: t.title,
    season: "All",
    count: t.count,
  })), "club_id,title,season");

  // Season-level Championship winners (achievements ?show=ch).
  const { error: csDelErr } = await supabase
    .from("championship_seasons")
    .delete()
    .neq("club_id", 0);
  if (csDelErr) throw new Error(`clear championship_seasons: ${csDelErr.message}`);
  const champRows = parseChampionshipSeasons(
    await fetchHtml(`${achievementsUrl()}?show=ch`),
  ).flatMap((c) => c.seasons.map((season) => ({ club_id: c.clubId, season })));
  if (champRows.length > 0) {
    await upsertChunked(supabase, "championship_seasons", champRows, "club_id,season");
  }
  log.push(`championship seasons: ${champRows.length}`);

  // Season-level Premiership winners (achievements ?show=pr).
  const { error: psDelErr } = await supabase
    .from("premiership_seasons")
    .delete()
    .neq("club_id", 0);
  if (psDelErr) throw new Error(`clear premiership_seasons: ${psDelErr.message}`);
  const premRows = parseChampionshipSeasons(
    await fetchHtml(`${achievementsUrl()}?show=pr`),
  ).flatMap((c) => c.seasons.map((season) => ({ club_id: c.clubId, season })));
  if (premRows.length > 0) {
    await upsertChunked(supabase, "premiership_seasons", premRows, "club_id,season");
  }
  log.push(`premiership seasons: ${premRows.length}`);

  log.push(`player_clubs: ${clubRows.size}`);
  log.push(`duration: ${Date.now() - startedAt}ms`);

  return { ok: true, log };
}

async function upsertChunked(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
  }
}