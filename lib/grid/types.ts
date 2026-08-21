export type Category =
  | "club"
  | "appearances"
  | "goals"
  | "red_cards"
  | "titles"
  | "minutes"
  | "clubs";

export const ALL_CATEGORIES: Category[] = [
  "club",
  "appearances",
  "goals",
  "red_cards",
  "titles",
  "minutes",
  "clubs",
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