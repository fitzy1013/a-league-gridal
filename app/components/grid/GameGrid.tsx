"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { CATEGORY_LABELS } from "@/lib/grid/labels";
import type { Category } from "@/lib/grid/types";
import { Button } from "@/components/ui/button";
import { recordResult } from "@/app/play/daily/actions";
import Cell from "./Cell";
import GuessInput from "./GuessInput";
import ResultModal from "./ResultModal";
import ShareButton from "./ShareButton";
import type { CellState, ClientGridSpec, PlayerOption } from "./types";

const EMPTY_CELL: CellState = { playerId: null, playerName: null, status: "empty" };

export default function GameGrid({ spec, userId }: { spec: ClientGridSpec; userId?: string | null }) {
  const size = spec.rowValues.length;
  const [cells, setCells] = useState<CellState[][]>(() =>
    Array.from({ length: size }, () => Array.from({ length: size }, () => ({ ...EMPTY_CELL }))),
  );
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const recordedRef = useRef(false);

  const correct = useMemo(
    () => cells.flat().filter((c) => c.status === "correct").length,
    [cells],
  );

  const labelFor = (category: Category) => CATEGORY_LABELS[category];

  const applyGuess = async (r: number, c: number, player: PlayerOption) => {
    if (submitting || revealed) return;
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

      const finished = updated.every((row) => row.every((cell) => cell.status !== "empty"));
      if (finished) {
        setShowResult(true);
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

  const reveal = () => {
    setCells((prev) =>
      prev.map((row, r) =>
        row.map((cell, c) => {
          if (cell.status === "correct") return cell;
          const sol = spec.solution.find((s) => s.rowIdx === r && s.colIdx === c);
          return {
            playerId: sol?.playerId ?? null,
            playerName: sol?.playerName ?? null,
            status: "revealed" as const,
          };
        }),
      ),
    );
    setRevealed(true);
    setShowResult(true);
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
          {!revealed && (
            <Button variant="ghost" size="sm" onClick={reveal} type="button">
              Reveal
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
            <div
              className="flex flex-col items-center justify-center rounded-md bg-accent px-2 py-2 text-center text-sm"
            >
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
                disabled={revealed}
                onClick={() => setSelected({ r, c })}
              />
            ))}
          </Fragment>
        ))}
      </div>

      {selected && !revealed && (
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

      <ResultModal
        open={showResult}
        rows={cells}
        mode={spec.mode}
        date={spec.date}
        correct={correct}
        total={size * size}
        revealed={revealed}
        onReveal={reveal}
        onClose={() => setShowResult(false)}
      />
    </div>
  );
}