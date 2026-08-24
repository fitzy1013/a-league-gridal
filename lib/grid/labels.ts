import type { BandedCategory, Category, NumericBand } from "./types";

export const GRID_SIZE = 3;

/** Stats season used for grid feasibility / solution checks. */
export const ALL_TIME_SEASON = "all";

/**
 * Minimum all-time appearances for a player to qualify for win-percentage
 * bands (avoids tiny-sample noise like 2 apps / 2 wins = 100%).
 * Keep in sync between generation and guess validation.
 */
export const WIN_PCT_MIN_APPEARANCES = 15;

/**
 * Nationalities with fewer players than this never become grid criteria
 * (cells would be near-impossible).
 */
export const MIN_NATIONALITY_PLAYERS = 4;

export const CATEGORY_LABELS: Record<Category, string> = {
  club: "Club",
  appearances: "Appearances",
  goals: "Goals",
  red_cards: "Red Cards",
  championships: "Championships",
  minutes: "Minutes",
  clubs: "Clubs",
  yellow_cards: "Yellow Cards",
  clean_sheets: "Clean Sheets (GK)",
  debut_age: "Debut Age",
  win_pct: "Win %",
  nationality: "Nationality",
  position: "Position",
  own_goals: "Own Goals",
  finals_goals: "Finals Goals",
  finals_apps: "Finals Apps",
};

/**
 * Maps a raw UAL position to the grid's grouped position labels.
 * Utility players qualify as both Defender and Mid/Fwd.
 */
export function positionLabels(position: string | null | undefined): string[] {
  switch (position) {
    case "Goalkeeper":
      return ["GK"];
    case "Defender":
      return ["Def"];
    case "Midfielder":
    case "Forward":
      return ["Mid/Fwd"];
    case "Utility":
      return ["Def", "Mid/Fwd"];
    default:
      return [];
  }
}

export const NUMERIC_BANDS: Record<BandedCategory, NumericBand[]> = {
  appearances: [
    { label: "Under 25", min: 0, max: 24 },
    // Legacy band kept only so the currently-live daily grid validates.
    // Excluded from generation (see DEPRECATED_BAND_LABELS); remove once it rotates out.
    { label: "25+", min: 25, max: Infinity },
    { label: "25-49", min: 25, max: 49 },
    { label: "50+", min: 50, max: Infinity },
    { label: "100+", min: 100, max: Infinity },
    { label: "200+", min: 200, max: Infinity },
  ],
  goals: [
    { label: "Under 5", min: 0, max: 4 },
    { label: "10-30", min: 10, max: 30 },
    { label: "20-50", min: 20, max: 50 },
    { label: "50+", min: 50, max: Infinity },
    { label: "100+", min: 100, max: Infinity },
  ],
  red_cards: [
    { label: "0", min: 0, max: 0 },
    { label: "1+", min: 1, max: Infinity },
    { label: "2+", min: 2, max: Infinity },
    { label: "3+", min: 3, max: Infinity },
  ],
  championships: [
    { label: "1+", min: 1, max: Infinity },
    { label: "2+", min: 2, max: Infinity },
  ],
  minutes: [
    { label: "Under 1000", min: 0, max: 999 },
    { label: "1000-4999", min: 1000, max: 4999 },
    { label: "5000+", min: 5000, max: Infinity },
    { label: "10000+", min: 10000, max: Infinity },
  ],
  clubs: [
    { label: "Under 3", min: 1, max: 2 },
    { label: "3+", min: 3, max: Infinity },
    { label: "5+", min: 5, max: Infinity },
  ],
  yellow_cards: [
    { label: "Under 5", min: 0, max: 4 },
    { label: "Under 10", min: 0, max: 9 },
    // Legacy band kept only so the currently-live daily grid validates.
    // Excluded from generation (see DEPRECATED_BAND_LABELS); remove once it rotates out.
    { label: "10+", min: 10, max: Infinity },
    { label: "10-50", min: 10, max: 50 },
    { label: "25+", min: 25, max: Infinity },
    { label: "50+", min: 50, max: Infinity },
  ],
  clean_sheets: [
    { label: "Under 5", min: 0, max: 4 },
    { label: "Under 10", min: 0, max: 9 },
    { label: "10-50", min: 10, max: 50 },
    { label: "10+", min: 10, max: Infinity },
    { label: "25+", min: 25, max: Infinity },
    { label: "50+", min: 50, max: Infinity },
  ],
  debut_age: [
    { label: "U19", min: 0, max: 19 },
    { label: "U21", min: 0, max: 21 },
    { label: "23+", min: 23, max: Infinity },
    { label: "27+", min: 27, max: Infinity },
    { label: "30+", min: 30, max: Infinity },
  ],
  win_pct: [
    { label: "60%+", min: 60, max: Infinity },
    { label: "55%+", min: 55, max: Infinity },
    { label: "45%+", min: 45, max: Infinity },
    { label: "Under 35%", min: 0, max: 34.999999 },
    { label: "Under 45%", min: 0, max: 44.999999 },
  ],
  own_goals: [
    { label: "1+", min: 1, max: Infinity },
    { label: "2+", min: 2, max: Infinity },
  ],
  finals_goals: [
    { label: "1+", min: 1, max: Infinity },
    { label: "2+", min: 2, max: Infinity },
  ],
  finals_apps: [
    { label: "5+", min: 5, max: Infinity },
    { label: "10+", min: 10, max: Infinity },
  ],
};

export function bandForLabel(
  category: BandedCategory,
  label: string,
): NumericBand | undefined {
  return NUMERIC_BANDS[category].find((b) => b.label === label);
}
