import type { Category, NumericBand } from "./types";

export const GRID_SIZE = 3;

/** Stats season used for grid feasibility / solution checks. */
export const ALL_TIME_SEASON = "all";

export const CATEGORY_LABELS: Record<Category, string> = {
  club: "Club",
  appearances: "Appearances",
  goals: "Goals",
  red_cards: "Red Cards",
  titles: "Titles",
  minutes: "Minutes",
};

export const NUMERIC_BANDS: Record<
  Extract<Category, "appearances" | "goals" | "red_cards" | "titles" | "minutes">,
  NumericBand[]
> = {
  appearances: [
    { label: "50+", min: 50, max: Infinity },
    { label: "100+", min: 100, max: Infinity },
    { label: "200+", min: 200, max: Infinity },
  ],
  goals: [
    { label: "20+", min: 20, max: Infinity },
    { label: "30+", min: 30, max: Infinity },
    { label: "50+", min: 50, max: Infinity },
  ],
  red_cards: [
    { label: "1+", min: 1, max: Infinity },
    { label: "2+", min: 2, max: Infinity },
    { label: "3+", min: 3, max: Infinity },
  ],
  titles: [
    { label: "1+", min: 1, max: Infinity },
    { label: "2+", min: 2, max: Infinity },
    { label: "3+", min: 3, max: Infinity },
  ],
  minutes: [
    { label: "1000+", min: 1000, max: Infinity },
    { label: "5000+", min: 5000, max: Infinity },
    { label: "10000+", min: 10000, max: Infinity },
  ],
};

export function bandForLabel(
  category: Extract<Category, "appearances" | "goals" | "red_cards" | "titles" | "minutes">,
  label: string,
): NumericBand | undefined {
  return NUMERIC_BANDS[category].find((b) => b.label === label);
}