import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/db/supabase-admin";
import { parseGeneralPage, parsePlayerStatsPage } from "@/lib/scrape/parse-players";
import { parseSquadPage } from "@/lib/scrape/parse-squad";
import { parseClubTitles, parsePlayerAwards } from "@/lib/scrape/parse-titles";
import {
  achievementsUrl,
  CLUBS,
  clubSquadUrl,
  fetchHtml,
  generalStatsUrl,
  parseSelectedSeason,
  playerAwardsUrl,
  playerStatsUrl,
} from "@/lib/scrape/ual";
import type { ParsedPlayerRow, ParsedSeasonStats } from "@/lib/scrape/types";

// Long enough for ~24 sequential page fetches. Hobby caps this at 60s.
export const maxDuration = 60;

const CURRENT_SEASON_FALLBACK = "2025-26";

/**
 * Scrapes Ultimate A-League and upserts clubs, players, stats, club history,
 * and achievements. Triggered by the Vercel cron in vercel.json.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

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

  // 4. General tab: multi-club history (all-time) ------------------------------
  const general = parseGeneralPage(await fetchHtml(generalStatsUrl("all")));
  log.push(`multi-club players: ${general.length}`);

  // 5. Squad pages: catch players with no stats yet + confirm current club -----
  let squadCount = 0;
  for (const club of CLUBS) {
    const html = await fetchHtml(clubSquadUrl(club.id));
    for (const m of parseSquadPage(html, club.id, club.name)) {
      squadCount++;
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
        existing.clubId ??= m.clubId;
        existing.nationality ??= m.nationality;
        existing.nationalityFlagUrl ??= m.nationalityFlagUrl;
      }
    }
  }
  log.push(`squad members parsed: ${squadCount}`);

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
    updated_at: now,
  })), "player_id,season");

  // player_clubs: current/last club for every player + full history for
  // multi-club players from the General tab.
  const clubRows = new Map<string, { player_id: number; club_id: number }>();
  for (const [playerId, p] of playerMap) {
    if (p.clubId != null) {
      clubRows.set(`${playerId}:${p.clubId}`, { player_id: playerId, club_id: p.clubId });
    }
  }
  for (const pc of general) {
    for (const clubId of pc.clubIds) {
      clubRows.set(`${pc.playerId}:${clubId}`, { player_id: pc.playerId, club_id: clubId });
    }
  }
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

  log.push(`player_clubs: ${clubRows.size}`);
  log.push(`duration: ${Date.now() - startedAt}ms`);

  return Response.json({ ok: true, log });
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