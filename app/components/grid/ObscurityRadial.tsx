"use client";

import { useState } from "react";

/**
 * Radial progress badge for the Wikipedia-based obscurity meta-score.
 * Shown from the start of a grid (value 0) and fills as correct answers
 * land. Includes an info pop-up explaining how the score works.
 */
export default function ObscurityRadial({
  value,
  max = 900,
  size = 104,
}: {
  value: number;
  max?: number;
  size?: number;
}) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            className="stroke-muted"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#c084fc"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${pct * circumference} ${circumference}`}
            className="transition-[stroke-dasharray] duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-extrabold leading-none">{value}</span>
          <span className="mt-0.5 text-[10px] text-muted-foreground">/ {max}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium text-muted-foreground">Obscurity Score</span>
        <span className="relative inline-flex">
          <button
            type="button"
            aria-label="How does Obscurity Score work?"
            className="rounded-full border border-muted-foreground/50 px-[4px] text-[9px] leading-[13px] text-muted-foreground hover:bg-accent"
            onClick={() => setInfoOpen((o) => !o)}
            onBlur={() => setInfoOpen(false)}
          >
            i
          </button>
          {infoOpen && (
            <span className="absolute left-1/2 top-full z-30 mt-1 w-56 -translate-x-1/2 rounded-md border bg-background p-2 text-left text-[10px] italic leading-snug text-muted-foreground shadow-md">
              Wouldn&apos;t you want to know? Send your guesses.
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
