export type Category =
  | "club"
  | "nationality"
  | "appearances"
  | "goals"
  | "red_cards"
  | "titles";

export const ALL_CATEGORIES: Category[] = [
  "club",
  "nationality",
  "appearances",
  "goals",
  "red_cards",
  "titles",
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