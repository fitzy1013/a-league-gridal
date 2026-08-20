import * as cheerio from "cheerio";
import { parseIntCell } from "./ual";
import type { PlayerStatsPage } from "./types";
import { parsePlayerStatsPage } from "./parse-players";
import type { ParsedClubTitle, ParsedPlayerTitle } from "./types";

/**
 * Yellow/red card counts come from the Bookings tab of the player stats page.
 * Thin wrapper kept separate so the file layout matches the scrape pipeline.
 */
export function parseBookingsPage(
  html: string,
  season: string,
): PlayerStatsPage {
  return parsePlayerStatsPage(html, "pb", season);
}

const CLUB_TITLE_COLUMNS: { index: number; title: string }[] = [
  { index: 2, title: "Premiership" },
  { index: 3, title: "Championship" },
  { index: 4, title: "AFC Champions League" },
  { index: 5, title: "AFC Cup" },
  { index: 6, title: "Oceania Champions League" },
  { index: 7, title: "Pre-Season Cup" },
  { index: 8, title: "Australia Cup" },
];

/**
 * Parses /statistics/achievements/ (default "Trophies (All)" view).
 * Club-level trophy totals, aggregated across all seasons -> season 'All'.
 */
export function parseClubTitles(html: string): ParsedClubTitle[] {
  const $ = cheerio.load(html);
  const result: ParsedClubTitle[] = [];

  $("#statistics-data-table tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 9) return;

    const clubAnchor = $(tds[0]).find("a.club-link-with-icon");
    const clubHref = clubAnchor.attr("href") ?? "";
    const clubIdMatch = clubHref.match(/club_id=(\d+)/);
    if (!clubIdMatch) return;
    const clubId = Number(clubIdMatch[1]);
    const clubName = clubAnchor.text().trim();

    for (const { index, title } of CLUB_TITLE_COLUMNS) {
      const count = parseIntCell($(tds[index]).text().trim());
      if (count && count > 0) {
        result.push({ clubId, clubName, title, count });
      }
    }
  });

  return result;
}

/**
 * Parses /statistics/achievements/?show=pa (Player - All awards).
 * Each row: Player | Total | season (Award)<br/>season (Award)...
 */
export function parsePlayerAwards(html: string): ParsedPlayerTitle[] {
  const $ = cheerio.load(html);
  const result: ParsedPlayerTitle[] = [];

  $("#statistics-data-table tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 3) return;

    const playerLink = $(tds[0]).find("a").first();
    const href = playerLink.attr("href") ?? "";
    const playerIdMatch = href.match(/player_id=(\d+)/);
    if (!playerIdMatch) return;
    const playerId = Number(playerIdMatch[1]);

    const awardsHtml = $(tds[2]).html() ?? "";
    for (const segment of awardsHtml.split(/<br\s*\/?>/i)) {
      const text = cheerio
        .load(segment)
        .text()
        .replace(/\s+/g, " ")
        .trim();
      const match = text.match(/^(.+?)\s*\(([^)]+)\)$/);
      if (!match) continue;
      const season = match[1].trim();
      const title = match[2].trim();
      if (season && title) {
        result.push({ playerId, title, season });
      }
    }
  });

  return result;
}