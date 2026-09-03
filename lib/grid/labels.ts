import type { BandedCategory, Category, NumericBand } from "./types";

export const GRID_SIZE = 3;

/** Stats season used for grid feasibility / solution checks. */
export const ALL_TIME_SEASON = "all";

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
  premierships: "Premierships",
  minutes: "Minutes",
  clubs: "Clubs (Career)",
  yellow_cards: "Yellow Cards",
  clean_sheets: "Clean Sheets (GK)",
  debut_age: "Debut Age",
  win_pct: "Win %",
  nationality: "Nationality",
  position: "Position",
  own_goals: "Own Goals (Career)",
  finals_goals: "Finals Goals (Career)",
  finals_apps: "Finals Apps (Career)",
  height: "Height (Career)",
  managed_by: "Managed By (Career)",
  golden_boot: "Golden Boot (Career)",
  jw_medal: "Johnny Warren Medal (Career)",
  marston_medal: "Joe Marston Medal (Career)",
  era: "Era",
  mid_season: "Mid-Season Move (Career)",
  one_club_stint: "Seasons at One Club (Career)",
  multi_goal_game: "Most Goals in a Game (Career)",
};

/**
 * Optional per-category explanations surfaced as an info pop-up on grid headers
 * (used where a short sub-label alone would be misleading).
 */
export const CATEGORY_INFO: Partial<Record<Category, string>> = {
  club: "Must have played at least 1 game for the club.",
  championships: "Must have played at least 1 game for the club in a championship-winning season.",
  premierships: "Must have played at least 1 game for the club in a premiership-winning season.",
  managed_by:
    "Counts anyone registered at the club in a season this manager was in charge — they don't need to have played under them.",

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
  premierships: [
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
  golden_boot: [
    { label: "1+", min: 1, max: Infinity },
    { label: "2+", min: 2, max: Infinity },
  ],
  jw_medal: [
    { label: "1+", min: 1, max: Infinity },
    { label: "2+", min: 2, max: Infinity },
  ],
  marston_medal: [
    { label: "1+", min: 1, max: Infinity },
  ],
  era: [
    // Broad legacy windows (kept)
    { label: "2005/06 to 2010/11", min: 2005, max: 2010 },
    { label: "2011/12 to 2017/18", min: 2011, max: 2017 },
    { label: "2018/19 to 2022/23", min: 2018, max: 2022 },
    // Narrow 2-season windows — heavier weighting pre-2019 via generator (see generator.ts)
    { label: "2005/06 to 2006/07", min: 2005, max: 2006 },
    { label: "2007/08 to 2008/09", min: 2007, max: 2008 },
    { label: "2009/10 to 2010/11", min: 2009, max: 2010 },
    { label: "2011/12 to 2012/13", min: 2011, max: 2012 },
    { label: "2013/14 to 2014/15", min: 2013, max: 2014 },
    { label: "2015/16 to 2016/17", min: 2015, max: 2016 },
    { label: "2017/18 to 2018/19", min: 2017, max: 2018 },
    { label: "2019/20 to 2020/21", min: 2019, max: 2020 },
    { label: "2021/22 to 2022/23", min: 2021, max: 2022 },
    { label: "2023/24 to 2024/25", min: 2023, max: 2024 },
    { label: "2025/26 to 2026/27", min: 2025, max: 2026 },
  ],
  mid_season: [
    { label: "2+ Clubs in One Season", min: 1, max: Infinity },
  ],
  one_club_stint: [
    { label: "3+", min: 3, max: Infinity },
    { label: "4+", min: 4, max: Infinity },
    { label: "5+", min: 5, max: Infinity },
  ],
  multi_goal_game: [
    { label: "Hat-trick (3+)", min: 3, max: Infinity },
    { label: "4+ in a game", min: 4, max: Infinity },
  ],
  height: [
    { label: "190cm+", min: 190, max: Infinity },
    { label: "170cm or shorter", min: 0, max: 170 },
  ],
};

export function bandForLabel(
  category: BandedCategory,
  label: string,
): NumericBand | undefined {
  return NUMERIC_BANDS[category].find((b) => b.label === label);
}
