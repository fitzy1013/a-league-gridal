"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CellState } from "./types";
import ShareButton from "./ShareButton";
import type { CellAnswerCount } from "./GameGrid";

export default function ResultModal({
  open,
  rows,
  mode,
  date,
  correct,
  total,
  counts,
  answerUrl,
  onClose,
}: {
  open: boolean;
  rows: CellState[][];
  mode: "daily" | "unlimited";
  date: string | null;
  correct: number;
  total: number;
  counts: CellAnswerCount[] | null;
  answerUrl: (r: number, c: number) => string;
  onClose: () => void;
}) {
  if (!open) return null;

  const countFor = (r: number, c: number): number | null =>
    counts?.find((x) => x.r === r && x.c === c)?.count ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold">
              {mode === "daily" ? "Daily grid" : "Unlimited grid"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {mode === "daily" ? date : "Practice mode"}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mb-4 flex items-baseline justify-center gap-2">
          <span className="text-4xl font-extrabold">{correct}</span>
          <span className="text-lg text-muted-foreground">/ {total}</span>
        </div>

        <p className="mb-2 text-center text-xs text-muted-foreground">
          Tap a box to view every correct answer for that cell
        </p>

        <div className="mb-5 grid grid-cols-3 gap-1.5">
          {rows.map((row, r) =>
            row.map((cell, c) => {
              const count = countFor(r, c);
              return (
                <a
                  key={`${r}-${c}`}
                  href={answerUrl(r, c)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex h-10 items-center justify-center rounded text-lg font-bold ${
                    cell.status === "correct"
                      ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                      : cell.status === "incorrect"
                        ? "bg-red-500/15 text-red-700 dark:text-red-300"
                        : "bg-muted text-foreground"
                  } hover:ring-2 hover:ring-ring`}
                >
                  {count === null ? "…" : count}
                </a>
              );
            }),
          )}
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <ShareButton rows={rows} mode={mode} date={date} correct={correct} total={total} />
          </div>
          <Button className="flex-1" onClick={onClose} type="button">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}