import * as cheerio from "cheerio";
import {
  normalizePosition,
  parseIntCell,
  UAL_BASE,
} from "./ual";
import type {
  ParsedClubMembership,
  ParsedPlayerClubs,
  ParsedPlayerRow,
  ParsedSeasonStats,
  PlayerStatsPage,
  StatType,
} from "./types";

/**
 * Parses the /statistics/player/ aggregation tables.
 *
 * Verified column layout per type (2026-08):
 *  - pa (Appearances): Player | Position | Club | Club | Nationality | Total (Starts) | Minutes
 *  - pg (Goals):       Player | Position | Club | Club | Nationality | Played | Goals | GPG
 *  - pb (Bookings):    Player | Position | Club | Club | Nationality | YC | RC | Total
 *  - pc (Clean Sheets):Player | Club | Club | Nationality | GP | Total | CS%
 */
export function parsePlayerStatsPage(
  html: string,
  type: StatType,
  season: string,
): PlayerStatsPage {
  const $ = cheerio.load(html);
  const players: ParsedPlayerRow[] = [];
  const stats: ParsedSeasonStats[] = [];

  $("#statistics-data-table tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 4) return;

    const playerLink = $(tds[0]).find("a").first();
    const href = playerLink.attr("href") ?? "";
    const playerIdMatch = href.match(/player_id=(\d+)/);
    if (!playerIdMatch) return;
    const playerId = Number(playerIdMatch[1]);
    const name = playerLink.text().trim();

    const position = type === "pc" ? undefined : normalizePosition($(tds[1]).text().trim());

    // The first td containing a club link carries club_id + full name.
    let clubId: number | undefined;
    let clubName: string | undefined;
    const clubCell = $(tds)
      .filter((_, td) => $(td).find(".club-link-with-icon").length > 0)
      .first();
    if (clubCell.length > 0) {
      const clubAnchor = clubCell.find("a.club-link-with-icon");
      const clubHref = clubAnchor.attr("href") ?? "";
      const clubIdMatch = clubHref.match(/club_id=(\d+)/);
      if (clubIdMatch) clubId = Number(clubIdMatch[1]);
      clubName = clubAnchor.text().trim() || undefined;
    }

    const nationalityDetail = $(tr).find(".nationality-detail").first();
    let nationality: string | undefined;
    let nationalityFlagUrl: string | undefined;
    if (nationalityDetail.length > 0) {
      const flagImg = nationalityDetail.find("img.nationality-flag").first();
      nationality = flagImg.attr("alt") ?? (nationalityDetail.text().trim() || undefined);
      const src = flagImg.attr("src");
      if (src) {
        nationalityFlagUrl = src.startsWith("http") ? src : `${UAL_BASE}${src}`;
      }
    }

    players.push({
      playerId,
      name,
      position,
      clubId,
      clubName,
      nationality,
      nationalityFlagUrl,
    });

    const stat: ParsedSeasonStats = { playerId, season };

    const numericText = (index: number): string =>
      index < tds.length ? $(tds[index]).text().trim() : "";

    if (type === "pa") {
      stat.appearances = parseIntCell(numericText(5));
      stat.minutes = parseIntCell(numericText(6));
    } else if (type === "pg") {
      stat.appearances = parseIntCell(numericText(5));
      stat.goals = parseIntCell(numericText(6));
    } else if (type === "pb") {
      stat.yellowCards = parseIntCell(numericText(5));
      stat.redCards = parseIntCell(numericText(6));
    } else if (type === "pc") {
      stat.appearances = parseIntCell(numericText(4));
      stat.cleanSheets = parseIntCell(numericText(5));
    }

    stats.push(stat);
  });

  return { season, type, players, stats };
}

/**
 * Parses the General tab (type=pl): Player | Nationality | Clubs | Total.
 * Lists players who have played for multiple clubs (>= 3 in the current
 * page state), used to build the all-time club membership map.
 */
export function parseGeneralPage(html: string): ParsedPlayerClubs[] {
  const $ = cheerio.load(html);
  const result: ParsedPlayerClubs[] = [];

  $("#statistics-data-table tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 3) return;

    const playerLink = $(tds[0]).find("a").first();
    const href = playerLink.attr("href") ?? "";
    const playerIdMatch = href.match(/player_id=(\d+)/);
    if (!playerIdMatch) return;
    const playerId = Number(playerIdMatch[1]);

    const clubIds: number[] = [];
    $(tds[2])
      .find("a")
      .each((_, a) => {
        const match = ($(a).attr("href") ?? "").match(/club_id=(\d+)/);
        if (match) clubIds.push(Number(match[1]));
      });

    if (clubIds.length > 0) {
      result.push({ playerId, clubIds });
    }
  });

  return result;
}

/**
 * Parses a club's All Players page (/club/?club_id=N&info=allplayers).
 *
 * Column layout (verified 2026-08):
 * Player | Position | Nationality | Current Club | GP | Goals | YC | RC | Wins | Win% | Age (Debut)
 * This is the complete all-time membership list for a club.
 */
export function parseAllPlayersPage(
  html: string,
  clubId: number,
  clubName: string,
): ParsedClubMembership[] {
  const $ = cheerio.load(html);
  const result: ParsedClubMembership[] = [];

  $("table.table.is-striped tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 5) return;

    const playerLink = $(tds[0]).find("a").first();
    const href = playerLink.attr("href") ?? "";
    const playerIdMatch = href.match(/player_id=(\d+)/);
    if (!playerIdMatch) return;
    const playerId = Number(playerIdMatch[1]);
    const name = playerLink.text().trim();
    if (!name) return;

    const position = normalizePosition($(tds[1]).text().trim());

    const nationalityDetail = $(tds[2]).find(".nationality-detail").first();
    let nationality: string | undefined;
    let nationalityFlagUrl: string | undefined;
    if (nationalityDetail.length > 0) {
      const flagImg = nationalityDetail.find("img.nationality-flag").first();
      nationality = flagImg.attr("alt") ?? (nationalityDetail.text().trim() || undefined);
      const src = flagImg.attr("src");
      if (src) {
        nationalityFlagUrl = src.startsWith("http") ? src : `${UAL_BASE}${src}`;
      }
    }

    result.push({
      playerId,
      name,
      position,
      clubId,
      clubName,
      nationality,
      nationalityFlagUrl,
      clubAppearances: parseIntCell($(tds[4]).text()),
      clubGoals: parseIntCell($(tds[5]).text()),
      clubYellowCards: parseIntCell($(tds[6]).text()),
      clubRedCards: parseIntCell($(tds[7]).text()),
      wins: parseIntCell($(tds[8]).text()),
      debutAge: parseIntCell($(tds[10]).text()),
    });
  });

  return result;
}
/**
 * Parses a single-value statistics page (the "Show" filter variants):
 * Player | Position | Club | Club | Nationality | <value>.
 * Used for finals appearances (pa/fin), finals goals (pg/fin) and
 * own goals (pg/og).
 */
export function parseSingleValueStats(
  html: string,
): { playerId: number; value: number }[] {
  const $ = cheerio.load(html);
  const result: { playerId: number; value: number }[] = [];

  $("#statistics-data-table tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 6) return;

    const playerLink = $(tds[0]).find("a").first();
    const href = playerLink.attr("href") ?? "";
    const playerIdMatch = href.match(/player_id=(\d+)/);
    if (!playerIdMatch) return;

    const value = parseIntCell($(tds[5]).text());
    if (value == null) return;
    result.push({ playerId: Number(playerIdMatch[1]), value });
  });

  return result;
}

/**
 * Extracts a player's height in cm from their UAL profile page
 * (meta description reads "... is 174 cm tall ...").
 */
export function parsePlayerHeight(html: string): number | null {
  const match = html.match(/is\s+(\d{2,3})\s*cm\s+tall/i);
  return match ? Number(match[1]) : null;
}
