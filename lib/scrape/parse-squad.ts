import * as cheerio from "cheerio";
import { normalizePosition, UAL_BASE } from "./ual";
import type { ParsedSquadMember } from "./types";

/**
 * Parses /club/?club_id=N&info=players "Current Players" tiles.
 * Used to seed players who haven't accumulated any stats yet (and to confirm
 * current club membership).
 */
export function parseSquadPage(html: string, clubId: number, clubName: string): ParsedSquadMember[] {
  const $ = cheerio.load(html);
  const result: ParsedSquadMember[] = [];

  let currentPlayersSection: ReturnType<typeof $> | null = null;
  for (const el of $("h2").toArray()) {
    if ($(el).text().trim() === "Current Players") {
      // The heading sits in its own wrapper; the player tiles are the next
      // sibling (a <div class="flex-vert">).
      currentPlayersSection = $(el).parent().next("div").first();
      break;
    }
  }

  if (!currentPlayersSection) return result;

  currentPlayersSection.find('a[href*="player_id="]').each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const match = href.match(/player_id=(\d+)/);
    if (!match) return;
    const playerId = Number(match[1]);

    const name = $(a).find("p.title.is-4").first().text().trim();
    const positionRaw = $(a)
      .find("p.subtitle.is-6.club-link span.padded-margin-right")
      .first()
      .text()
      .trim();
    const position = normalizePosition(positionRaw.replace(/,.*$/, "").trim());

    const flagImg = $(a).find("img.nationality-flag").first();
    let nationality: string | undefined;
    let nationalityFlagUrl: string | undefined;
    if (flagImg.length > 0) {
      nationality = flagImg.attr("alt") ?? undefined;
      const src = flagImg.attr("src");
      if (src) {
        nationalityFlagUrl = src.startsWith("http") ? src : `${UAL_BASE}${src}`;
      }
    }

    if (name) {
      result.push({
        playerId,
        name,
        position,
        clubId,
        clubName,
        nationality,
        nationalityFlagUrl,
      });
    }
  });

  return result;
}