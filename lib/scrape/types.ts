export interface ClubRecord {
  id: number;
  name: string;
  short_name: string;
  logo_url: string;
}

export interface ParsedPlayerRow {
  playerId: number;
  name: string;
  position?: string;
  clubId?: number;
  clubName?: string;
  nationality?: string;
  nationalityFlagUrl?: string;
}

export interface ParsedSeasonStats {
  playerId: number;
  season: string;
  appearances?: number;
  goals?: number;
  yellowCards?: number;
  redCards?: number;
  cleanSheets?: number;
}

export interface ParsedPlayerClubs {
  playerId: number;
  clubIds: number[];
}

export interface ParsedClubTitle {
  clubId: number;
  clubName: string;
  title: string;
  count: number;
}

export interface ParsedPlayerTitle {
  playerId: number;
  title: string;
  season: string;
}

export interface ParsedSquadMember {
  playerId: number;
  name: string;
  position?: string;
  clubId: number;
  clubName: string;
  nationality?: string;
  nationalityFlagUrl?: string;
}

export type StatType = "pa" | "pg" | "pb" | "pc";

export interface PlayerStatsPage {
  season: string;
  type: StatType;
  players: ParsedPlayerRow[];
  stats: ParsedSeasonStats[];
}