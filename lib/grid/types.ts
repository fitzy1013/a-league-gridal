export type Category =
  | "club"
  | "appearances"
  | "goals"
  | "red_cards"
  | "championships"
  | "minutes"
  | "clubs"
  | "yellow_cards"
  | "clean_sheets"
  | "debut_age"
  | "win_pct"
  | "nationality"
  | "position"
  | "own_goals"
  | "finals_goals"
  | "finals_apps"
  | "height";

/** Categories whose criteria are numeric bands (see NUMERIC_BANDS). */
export type BandedCategory = Extract<
  Category,
  | "appearances"
  | "goals"
  | "red_cards"
  | "championships"
  | "minutes"
  | "clubs"
  | "yellow_cards"
  | "clean_sheets"
  | "debut_age"
  | "win_pct"
  | "own_goals"
  | "finals_goals"
  | "finals_apps"
  | "height"
>;

/** Categories whose criteria are plain values (club name, country, position). */
export type CategoricalCategory = Extract<Category, "club" | "nationality" | "position">;

/**
 * Stat categories that are evaluated PER CLUB when paired with a Club
 * criterion in the same cell: e.g. "Melbourne Victory x 20+ Goals" requires
 * 20+ goals scored FOR Melbourne Victory. All other categories (titles,
 * minutes, nationality, position, clubs) stay career-wide even when paired
 * with a club.
 */
export const PAIR_AWARE_CATEGORIES: BandedCategory[] = [
  "appearances",
  "goals",
  "yellow_cards",
  "red_cards",
  "win_pct",
  "debut_age",
];

export function isPairAwareCategory(category: Category): boolean {
  return (PAIR_AWARE_CATEGORIES as Category[]).includes(category);
}

export const ALL_CATEGORIES: Category[] = [
  "club",
  "appearances",
  "goals",
  "red_cards",
  "championships",
  "minutes",
  "clubs",
  "yellow_cards",
  "clean_sheets",
  "debut_age",
  "win_pct",
  "nationality",
  "position",
  "own_goals",
  "finals_goals",
  "finals_apps",
  "height",
];

export interface NumericBand {
  label: string;
  min: number;
  max: number;
}

export interface CellSolution {
  rowIdx: number;
  colIdx: number;
  playerId: number;
  playerName?: string;
}

export interface GridSpec {
  rowTypes: Category[];
  colTypes: Category[];
  rowValues: string[]; // display labels
  colValues: string[]; // display labels
  solution: CellSolution[];
}
