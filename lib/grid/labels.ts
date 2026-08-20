import type { Category, NumericBand } from "./types";

export const GRID_SIZE = 3;

/** Stats season used for grid feasibility / solution checks. */
export const ALL_TIME_SEASON = "all";

export const CATEGORY_LABELS: Record<Category, string> = {
  club: "Club",
  nationality: "Nationality",
  appearances: "Appearances",
  goals: "Goals",
  red_cards: "Red Cards",
  titles: "Titles",
};

export const NUMERIC_BANDS: Record<
  Extract<Category, "appearances" | "goals" | "red_cards" | "titles">,
  NumericBand[]
> = {
  appearances: [
    { label: "0-49", min: 0, max: 49 },
    { label: "50-99", min: 50, max: 99 },
    { label: "100-199", min: 100, max: 199 },
    { label: "200+", min: 200, max: Infinity },
  ],
  goals: [
    { label: "0", min: 0, max: 0 },
    { label: "1-9", min: 1, max: 9 },
    { label: "10-29", min: 10, max: 29 },
    { label: "30+", min: 30, max: Infinity },
  ],
  red_cards: [
    { label: "0", min: 0, max: 0 },
    { label: "1", min: 1, max: 1 },
    { label: "2", min: 2, max: 2 },
    { label: "3+", min: 3, max: Infinity },
  ],
  titles: [
    { label: "1", min: 1, max: 1 },
    { label: "2", min: 2, max: 2 },
    { label: "3+", min: 3, max: Infinity },
  ],
};

export function bandLabelFor(
  category: Extract<Category, "appearances" | "goals" | "red_cards" | "titles">,
  value: number,
): string | undefined {
  const bands = NUMERIC_BANDS[category];
  for (const band of bands) {
    if (value >= band.min && value <= band.max) return band.label;
  }
  return undefined;
}

export function bandForLabel(
  category: Extract<Category, "appearances" | "goals" | "red_cards" | "titles">,
  label: string,
): NumericBand | undefined {
  return NUMERIC_BANDS[category].find((b) => b.label === label);
}