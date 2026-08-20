import * as cheerio from "cheerio";
import type { StatType } from "./types";

export const UAL_BASE = "https://www.ultimatealeague.com";

// Verified against the live site nav (2026-08). id = UAL club_id.
export const CLUBS: {
  id: number;
  name: string;
  short_name: string;
  logo_url: string;
}[] = [
  { id: 1, name: "Adelaide United", short_name: "ADL", logo_url: `${UAL_BASE}/_images/club/adl.svg` },
  { id: 2, name: "Central Coast Mariners", short_name: "CCM", logo_url: `${UAL_BASE}/_images/club/ccm.svg` },
  { id: 3, name: "Melbourne Victory", short_name: "MVC", logo_url: `${UAL_BASE}/_images/club/mvc.svg` },
  { id: 4, name: "Newcastle Jets", short_name: "NEW", logo_url: `${UAL_BASE}/_images/club/new.svg` },
  { id: 5, name: "Perth Glory", short_name: "PER", logo_url: `${UAL_BASE}/_images/club/per.svg` },
  { id: 6, name: "Brisbane Roar", short_name: "BRI", logo_url: `${UAL_BASE}/_images/club/bri.svg` },
  { id: 7, name: "Sydney FC", short_name: "SYD", logo_url: `${UAL_BASE}/_images/club/syd.svg` },
  { id: 8, name: "Wellington Phoenix", short_name: "WEL", logo_url: `${UAL_BASE}/_images/club/wel.svg` },
  { id: 9, name: "New Zealand Knights", short_name: "NZK", logo_url: `${UAL_BASE}/_images/club/nzk.svg` },
  { id: 10, name: "Gold Coast United", short_name: "GCU", logo_url: `${UAL_BASE}/_images/club/gcu.svg` },
  { id: 11, name: "North Queensland Fury", short_name: "NQF", logo_url: `${UAL_BASE}/_images/club/nqf.svg` },
  { id: 12, name: "Melbourne City", short_name: "MCY", logo_url: `${UAL_BASE}/_images/club/mcy.svg` },
  { id: 13, name: "Western Sydney Wanderers", short_name: "WSW", logo_url: `${UAL_BASE}/_images/club/wsw.svg` },
  { id: 14, name: "Western United", short_name: "WUN", logo_url: `${UAL_BASE}/_images/club/wun.svg` },
  { id: 15, name: "Macarthur FC", short_name: "MAC", logo_url: `${UAL_BASE}/_images/club/mac.svg` },
  { id: 16, name: "Auckland FC", short_name: "AKL", logo_url: `${UAL_BASE}/_images/club/akl.svg` },
];

export function playerStatsUrl(type: StatType, season: string): string {
  return `${UAL_BASE}/statistics/player/?type=${type}&season=${encodeURIComponent(season)}`;
}

export function generalStatsUrl(season: string): string {
  return `${UAL_BASE}/statistics/player/?type=pl&season=${encodeURIComponent(season)}`;
}

export function achievementsUrl(): string {
  return `${UAL_BASE}/statistics/achievements/`;
}

export function playerAwardsUrl(): string {
  return `${UAL_BASE}/statistics/achievements/?show=pa`;
}

export function clubSquadUrl(clubId: number): string {
  return `${UAL_BASE}/club/?club_id=${clubId}&info=players`;
}

export async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "user-agent": "aliga-gridal/1.0 (+https://github.com; game data scraper)",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    throw new Error(`UAL fetch failed: ${res.status} ${url}`);
  }
  return res.text();
}

/** Parses the currently selected season out of the stats page filter. */
export function parseSelectedSeason(html: string, fallback: string): string {
  const $ = cheerio.load(html);
  let selected: string | undefined;
  $("#filter-season option").each((_, el) => {
    const value = $(el).attr("value");
    if (value && $(el).attr("selected") !== undefined) {
      selected = value;
    }
  });
  return selected && selected !== "all" ? selected : fallback;
}

const SHORT_POSITION_TO_FULL: Record<string, string> = {
  GK: "Goalkeeper",
  DEF: "Defender",
  MID: "Midfielder",
  FWD: "Forward",
};

export function normalizePosition(position: string | undefined): string | undefined {
  if (!position) return undefined;
  const trimmed = position.trim();
  return SHORT_POSITION_TO_FULL[trimmed.toUpperCase()] ?? trimmed;
}

/** "85" -> 85 ; "1 (0)" -> 1 (total appearances with starts in parens). */
export function parseIntCell(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^(\d+)/);
  return match ? Number(match[1]) : undefined;
}