"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_LABELS } from "@/lib/grid/labels";
import type { Category } from "@/lib/grid/types";
import { Button } from "@/components/ui/button";
import { recordResult } from "@/app/play/daily/actions";
import { loadProgress, pruneOldProgress, saveProgress } from "./progress";
import Cell from "./Cell";
import GuessInput from "./GuessInput";
import NextGridCountdown from "./NextGridCountdown";
import ResultModal from "./ResultModal";
import ShareButton from "./ShareButton";
import type { CellState, ClientGridSpec, PlayerOption } from "./types";

const EMPTY_CELL: CellState = { playerId: null, playerName: null, status: "empty" };

export interface CellAnswerCount {
  r: number;
  c: number;
  count: number;
}

async function fetchCounts(spec: ClientGridSpec): Promise<CellAnswerCount[]> {
  const payload: Record<string, unknown> = { cells: [] as [number, number][] };
  if (spec.gridId) {
    payload.gridId = spec.gridId;
  } else {
    payload.rowTypes = spec.rowTypes;
    payload.colTypes = spec.colTypes;
    payload.rowValues = spec.rowValues;
    payload.colValues = spec.colValues;
  }
  const res = await fetch("/api/cell-answers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { cells?: CellAnswerCount[] };
  return data.cells ?? [];
}

export default function GameGrid({ spec, userId }: { spec: ClientGridSpec; userId?: string | null }) {
  const size = spec.rowValues.length;
  const [cells, setCells] = useState<CellState[][]>(() =>
    Array.from({ length: size }, () => Array.from({ length: size }, () => ({ ...EMPTY_CELL }))),
  );
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);
  const [finished, setFinished] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [counts, setCounts] = useState<CellAnswerCount[] | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const recordedRef = useRef(false);

  // Restore saved progress after mount (client-only, SSR-safe).
  useEffect(() => {
    pruneOldProgress();
    const stored = loadProgress(spec, size);
    if (stored) {
      setCells(stored.cells);
      setFinished(stored.finished);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist progress on every change (daily grids only).
  useEffect(() => {
    if (!hydrated) return;
    saveProgress(spec, cells, finished);
  }, [hydrated, spec, cells, finished]);

  const correct = useMemo(
    () => cells.flat().filter((c) => c.status === "correct").length,
    [cells],
  );

  const labelFor = (category: Category) => CATEGORY_LABELS[category];

  const openSummary = useCallback(async () => {
    setShowResult(true);
    setCounts(null);
    try {
      setCounts(await fetchCounts(spec));
    } catch {
      setCounts([]);
    }
  }, [spec]);

  const applyGuess = async (r: number, c: number, player: PlayerOption) => {
    if (submitting || finished) return;
    setSubmitting(true);
    try {
      let isCorrect = false;
      try {
        const payload = spec.gridId
          ? { gridId: spec.gridId, rowIdx: r, colIdx: c, playerId: player.id }
          : {
              rowTypes: spec.rowTypes,
              colTypes: spec.colTypes,
              rowValues: spec.rowValues,
              colValues: spec.colValues,
              rowIdx: r,
              colIdx: c,
              playerId: player.id,
            };
        const res = await fetch("/api/validate-guess", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as { correct?: boolean };
        isCorrect = data.correct === true;
      } catch {
        // Network/server failure: mark incorrect rather than leaving the cell
        // stuck in a validating state.
        isCorrect = false;
      }

      const updated = cells.map((row) => row.slice());
      updated[r][c] = {
        playerId: player.id,
        playerName: player.name,
        status: isCorrect ? "correct" : "incorrect",
      };
      setCells(updated);
      setSelected(null);

      const finishedRound = updated.every((row) => row.every((cell) => cell.status !== "empty"));
      if (finishedRound) {
        setFinished(true);
        await openSummary();
        if (spec.mode === "daily" && userId && spec.gridId && !recordedRef.current) {
          recordedRef.current = true;
          const count = updated.flat().filter((cell) => cell.status === "correct").length;
          recordResult(spec.gridId, count, size * size).catch(() => {});
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const confirmGiveUp = () => {
    setConfirming(false);
    setFinished(true);
    if (spec.mode === "daily" && userId && spec.gridId && !recordedRef.current) {
      recordedRef.current = true;
      recordResult(spec.gridId, correct, size * size).catch(() => {});
    }
    void openSummary();
  };

  const answerUrl = (r: number, c: number): string => {
    if (spec.gridId) {
      return `/answers?gridId=${encodeURIComponent(spec.gridId)}&r=${r}&c=${c}`;
    }
    const params = new URLSearchParams({
      r: String(r),
      c: String(c),
      rowTypes: JSON.stringify(spec.rowTypes),
      colTypes: JSON.stringify(spec.colTypes),
      rowValues: JSON.stringify(spec.rowValues),
      colValues: JSON.stringify(spec.colValues),
    });
    return `/answers?${params.toString()}`;
  };

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">
            {spec.mode === "daily" ? "Daily Grid" : "Unlimited Grid"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {spec.mode === "daily" && spec.date ? spec.date : "Practice mode — no persistence"}
          </p>
          {spec.mode === "daily" && finished && (
            <div className="mt-1">
              <NextGridCountdown />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {correct > 0 && (
            <span className="rounded-full bg-accent px-3 py-1 text-sm font-medium">
              {correct}/{size * size}
            </span>
          )}
          {spec.mode === "daily" && (
            <ShareButton rows={cells} mode="daily" date={spec.date} correct={correct} total={size * size} />
          )}
          {!finished ? (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} type="button">
              Give up
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => void openSummary()} type="button">
              View Summary
            </Button>
          )}
        </div>
      </div>

      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `auto repeat(${size}, minmax(0, 1fr))` }}
      >
        <div className="flex items-center justify-center rounded-md px-2 text-xs font-medium text-muted-foreground">
          {size}×{size}
        </div>
        {spec.colValues.map((value, c) => (
          <div
            key={`col-${c}`}
            className="flex flex-col items-center justify-center rounded-md bg-accent px-2 py-2 text-center text-sm"
          >
            <span className="leading-tight">{value}</span>
            {spec.colTypes[c] !== "club" && (
              <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {labelFor(spec.colTypes[c])}
              </span>
            )}
          </div>
        ))}

        {cells.map((row, r) => (
          <Fragment key={`row-${r}`}>
            <div className="flex flex-col items-center justify-center rounded-md bg-accent px-2 py-2 text-center text-sm">
              <span className="leading-tight">{spec.rowValues[r]}</span>
              {spec.rowTypes[r] !== "club" && (
                <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {labelFor(spec.rowTypes[r])}
                </span>
              )}
            </div>
            {row.map((cell, c) => (
              <Cell
                key={`cell-${r}-${c}`}
                cell={cell}
                selected={selected?.r === r && selected?.c === c}
                disabled={finished}
                onClick={() => setSelected({ r, c })}
              />
            ))}
          </Fragment>
        ))}
      </div>

      {selected && !finished && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-muted-foreground">
            Player who fits{" "}
            <span className="font-medium text-foreground">{spec.rowValues[selected.r]}</span>
            {spec.rowTypes[selected.r] !== "club" && ` (${labelFor(spec.rowTypes[selected.r])})`} ×{" "}
            <span className="font-medium text-foreground">{spec.colValues[selected.c]}</span>
            {spec.colTypes[selected.c] !== "club" && ` (${labelFor(spec.colTypes[selected.c])})`}
          </p>
          <GuessInput
            onSelect={(player) => applyGuess(selected.r, selected.c, player)}
            onClose={() => setSelected(null)}
          />
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-lg">
            <h2 className="text-lg font-bold">Give up this round?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your score will be recorded and the round will end. You can view the answer summary
              for each cell.
            </p>
            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)} type="button">
                Keep playing
              </Button>
              <Button className="flex-1" onClick={confirmGiveUp} type="button">
                Give up
              </Button>
            </div>
          </div>
        </div>
      )}

      <ResultModal
        open={showResult}
        rows={cells}
        spec={spec}
        correct={correct}
        total={size * size}
        counts={counts}
        answerUrl={answerUrl}
        onClose={() => setShowResult(false)}
      />
    </div>
  );
}