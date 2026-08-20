import type { Category, CellSolution } from "@/lib/grid/types";

export type CellStatus = "empty" | "correct" | "incorrect" | "revealed";

export interface CellState {
  playerId: number | null;
  playerName: string | null;
  status: CellStatus;
}

export interface ClientGridSpec {
  gridId: string | null;
  mode: "daily" | "unlimited";
  date: string | null;
  rowTypes: Category[];
  colTypes: Category[];
  rowValues: string[];
  colValues: string[];
  solution: CellSolution[];
}

export interface PlayerOption {
  id: number;
  name: string;
  position: string | null;
  club_id: number | null;
  nationality: string | null;
  nationality_flag_url: string | null;
}