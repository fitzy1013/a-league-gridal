"use client";

import { Fragment, useState } from "react";
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
  obscurity,
  onClose,
}: {
  open: boolean;
  rows: CellState[][];
  spec: ClientGridSpec;
  correct: number;
  total: number;
  counts: CellAnswerCount[] | null;
  answerUrl: (r: number, c: number) => string;
  obscurity?: number | null;
  onClose: () => void;
}) {
  if (!open) return null;

  const maxObscurity = total * 100;

  const [activeCell, setActiveCell] = useState<{ r: number; c: number } | null>(null);

  const countFor = (r: number, c: number): number | null =>
    counts?.find((x) => x.r === r && x.c === c)?.count ?? null;

  const activeData = activeCell ? counts?.find((x) => x.r === activeCell.r && x.c === activeCell.c) : null;
  const activePlayers = activeData?.players ?? [];
  const activeLabel =
    activeCell != null
      ? `${spec.rowValues[activeCell.r]} × ${spec.colValues[activeCell.c]}`
      : ""; 

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

        {obscurity != null && (
          <div className="mb-4 flex flex-col items-center gap-1">
            <svg width="88" height="88" viewBox="0 0 88 88" className="-rotate-90">
              <circle cx="44" cy="44" r="36" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted" />
              <circle
                cx="44"
                cy="44"
                r="36"
                fill="none"
                stroke="url(#obscurity-gradient)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(obscurity / maxObscurity) * 226.2} 226.2`}
              />
              <defs>
                <linearGradient id="obscurity-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#a78bfa" />
                  <stop offset="100%" stopColor="#f472b6" />
                </linearGradient>
              </defs>
            </svg>
            <div className="-mt-[62px] mb-[38px] text-center">
              <div className="text-xl font-extrabold">{obscurity}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">/ 900</div>
            </div>
            <p className="text-xs text-muted-foreground">Obscurity score</p>
          </div>
        )}

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
                  <button
                    key={`cell-${r}-${c}`}
                    type="button"
                    onClick={() => setActiveCell({ r, c })}
                    className={`flex h-14 min-w-0 items-center justify-center rounded transition-colors hover:ring-2 hover:ring-ring ${statusClasses[row[c].status]}`}
                  >
                    {count === null ? (
                      <span className="text-lg font-bold text-muted-foreground">…</span>
                    ) : (
                      <span className="text-lg font-bold text-blue-700 underline decoration-blue-700 dark:text-blue-400 dark:decoration-blue-400">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <ShareButton
              rows={rows}
              mode={spec.mode}
              date={spec.date}
              correct={correct}
              total={total}
              obscurity={obscurity ?? null}
            />
          </div>
          <Button className="flex-1" onClick={onClose} type="button">
            Close
          </Button>
        </div>
      </div>

      {activeCell && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setActiveCell(null)}>
          <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-bold">Answers</h3>
                <p className="text-sm text-muted-foreground">{activeLabel}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {activeData ? `${activeData.count} ${activeData.count === 1 ? "player" : "players"} fit this cell` : "Loading..."}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setActiveCell(null)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="max-h-[50vh] overflow-auto">
              {!activeData ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : activePlayers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No players match both criteria.</p>
              ) : (
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {activePlayers.map((p) => (
                    <li key={p.id} className="rounded-md bg-accent px-3 py-2 text-sm font-medium">
                      {p.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <a
                href={answerUrl(activeCell.r, activeCell.c)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground underline"
              >
                Open full page
              </a>
              <Button size="sm" onClick={() => setActiveCell(null)} type="button">
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}