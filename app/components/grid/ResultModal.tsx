"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CellState } from "./types";
import ShareButton from "./ShareButton";

export default function ResultModal({
  open,
  rows,
  mode,
  date,
  correct,
  total,
  revealed,
  onReveal,
  onClose,
}: {
  open: boolean;
  rows: CellState[][];
  mode: "daily" | "unlimited";
  date: string | null;
  correct: number;
  total: number;
  revealed: boolean;
  onReveal?: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

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

        <div className="mb-5 grid grid-cols-3 gap-1.5" aria-hidden>
          {rows.map((row, r) =>
            row.map((cell, c) => (
              <div
                key={`${r}-${c}`}
                className={`flex h-10 items-center justify-center rounded text-lg ${
                  cell.status === "correct"
                    ? "bg-emerald-500/20"
                    : cell.status === "incorrect"
                      ? "bg-red-500/15"
                      : cell.status === "revealed"
                        ? "bg-yellow-500/20"
                        : "bg-muted"
                }`}
              >
                {cell.status === "correct"
                  ? "🟩"
                  : cell.status === "incorrect"
                    ? "🟥"
                    : cell.status === "revealed"
                      ? "🟨"
                      : "⬜"}
              </div>
            )),
          )}
        </div>

        {!revealed && onReveal && (
          <Button variant="outline" className="mb-2 w-full" onClick={onReveal} type="button">
            Reveal answers
          </Button>
        )}

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