"use client";

import { Fragment } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CATEGORY_LABELS } from "@/lib/grid/labels";
import type { CellState, ClientGridSpec } from "./types";
import ShareButton from "./ShareButton";
import type { CellAnswerCount } from "./GameGrid";

const statusClasses: Record<CellState["status"], string> = {
  empty: "bg-muted text-foreground",
  correct: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  incorrect: "bg-red-500/15 text-red-700 dark:text-red-300",
  revealed: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
};

export default function ResultModal({
  open,
  rows,
  spec,
  correct,
  total,
  counts,
  answerUrl,
  onClose,
}: {
  open: boolean;
  rows: CellState[][];
  spec: ClientGridSpec;
  correct: number;
  total: number;
  counts: CellAnswerCount[] | null;
  answerUrl: (r: number, c: number) => string;
  onClose: () => void;
}) {
  if (!open) return null;

  const countFor = (r: number, c: number): number | null =>
    counts?.find((x) => x.r === r && x.c === c)?.count ?? null;

  const headerFor = (value: string, category: string) => (
    <div className="flex min-h-14 w-full min-w-0 flex-col items-center justify-center overflow-hidden px-1 py-1.5 text-center">
      <span className="line-clamp-2 w-full break-words text-[11px] font-medium leading-tight">
        {value}
      </span>
      {category !== "club" && (
        <span className="mt-0.5 max-w-full truncate text-[9px] uppercase tracking-wide text-muted-foreground">
          {CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]}
        </span>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold">
              {spec.mode === "daily" ? "Daily grid" : "Unlimited grid"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {spec.mode === "daily" ? spec.date : "Practice mode"}
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
          Tap a number to view every correct answer for that cell
        </p>

        <div
          className="mb-5 grid gap-1"
          style={{ gridTemplateColumns: `auto repeat(${rows.length}, minmax(0, 1fr))` }}
        >
          <div className="flex items-center justify-center rounded-md px-1 text-xs font-medium text-muted-foreground">
            {rows.length}×{rows.length}
          </div>
          {spec.colValues.map((value, c) => (
            <div key={`col-${c}`} className="min-w-0 rounded-md bg-accent">
              {headerFor(value, spec.colTypes[c])}
            </div>
          ))}

          {rows.map((row, r) => (
            <Fragment key={`row-${r}`}>
              <div className="min-w-0 rounded-md bg-accent">
                {headerFor(spec.rowValues[r], spec.rowTypes[r])}
              </div>
              {Array.from({ length: row.length }, (_, c) => {
                const count = countFor(r, c);
                return (
                  <a
                    key={`cell-${r}-${c}`}
                    href={answerUrl(r, c)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex h-14 min-w-0 items-center justify-center rounded transition-colors hover:ring-2 hover:ring-ring ${statusClasses[row[c].status]}`}
                  >
                    {count === null ? (
                      <span className="text-lg font-bold text-muted-foreground">…</span>
                    ) : (
                      <span className="text-lg font-bold text-blue-700 underline decoration-blue-700 dark:text-blue-400 dark:decoration-blue-400">
                        {count}
                      </span>
                    )}
                  </a>
                );
              })}
            </Fragment>
          ))}
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <ShareButton rows={rows} mode={spec.mode} date={spec.date} correct={correct} total={total} />
          </div>
          <Button className="flex-1" onClick={onClose} type="button">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}