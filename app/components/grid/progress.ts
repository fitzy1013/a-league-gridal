import type { CellState, ClientGridSpec } from "./types";

const PREFIX = "grid:progress:";
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const STATUSES = new Set(["empty", "correct", "incorrect", "revealed"]);

export interface StoredProgress {
  cells: CellState[][];
  finished: boolean;
  obscurity?: number | null;
}

function keyFor(spec: ClientGridSpec): string | null {
  if (spec.mode !== "daily" || !spec.gridId) return null;
  return `${PREFIX}${spec.gridId}`;
}

/** Restores saved progress for this grid, or null when absent/corrupt. */
export function loadProgress(spec: ClientGridSpec, size: number): StoredProgress | null {
  const key = keyFor(spec);
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; cells?: unknown; finished?: unknown; obscurity?: unknown };
    if (parsed.v !== 1 || !Array.isArray(parsed.cells)) return null;
    const cells = parsed.cells as CellState[][];
    if (
      cells.length !== size ||
      cells.some((row) => !Array.isArray(row) || row.length !== size)
    ) {
      return null;
    }
    for (const row of cells) {
      for (const cell of row) {
        if (
          typeof cell?.status !== "string" ||
          !STATUSES.has(cell.status) ||
          (cell.playerId !== null && typeof cell.playerId !== "number") ||
          (cell.playerName !== null && typeof cell.playerName !== "string")
        ) {
          return null;
        }
      }
    }
    if (typeof parsed.finished !== "boolean") return null;
    const obscurity =
      typeof parsed.obscurity === "number" && Number.isFinite(parsed.obscurity) ? parsed.obscurity : null;
    return { cells, finished: parsed.finished, obscurity };
  } catch {
    return null;
  }
}

export function saveProgress(
  spec: ClientGridSpec,
  cells: CellState[][],
  finished: boolean,
  obscurity?: number | null,
): void {
  const key = keyFor(spec);
  if (!key || typeof window === "undefined") return;
  try {
    const payload = JSON.stringify({ v: 1, savedAt: Date.now(), cells, finished, obscurity: obscurity ?? null });
    window.localStorage.setItem(key, payload);
  } catch {
    // storage unavailable/full — progress simply won't persist
  }
}

/** Removes saved progress older than 60 days. */
export function pruneOldProgress(): void {
  if (typeof window === "undefined") return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const raw = window.localStorage.getItem(key);
        const parsed = raw ? (JSON.parse(raw) as { savedAt?: number }) : null;
        if (
          !parsed ||
          typeof parsed.savedAt !== "number" ||
          Date.now() - parsed.savedAt > MAX_AGE_MS
        ) {
          stale.push(key);
        }
      } catch {
        stale.push(key);
      }
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}