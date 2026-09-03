"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { DailyTheme } from "@/lib/grid/generate-daily";
import GameGrid from "./GameGrid";
import type { ClientGridSpec } from "./types";

const THEMES: DailyTheme[] = ["achievement", "balanced", "veryChallenging", "throwback", "deepThrowback", "statHeavy"];
const LABELS: Record<DailyTheme, string> = {
  achievement: "Achievement (≥2 awards/finals/prem/champ)",
  balanced: "Balanced",
  veryChallenging: "Very Challenging",
  throwback: "Throwback ending ≤2013/14",
  deepThrowback: "Deep Throwback ending ≤09/10",
  statHeavy: "Stat Heavy",
};

export default function DevThemeCycler() {
  const [preview, setPreview] = useState<ClientGridSpec | null>(null);
  const [loading, setLoading] = useState<DailyTheme | null>(null);
  const [activeTheme, setActiveTheme] = useState<DailyTheme | null>(null);

  const loadTheme = async (theme: DailyTheme) => {
    setLoading(theme);
    setActiveTheme(theme);
    try {
      const res = await fetch("/api/random-grid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme }),
      });
      const data = (await res.json()) as ClientGridSpec & { theme?: DailyTheme };
      setPreview({
        gridId: null,
        mode: "unlimited",
        date: null,
        rowTypes: data.rowTypes,
        colTypes: data.colTypes,
        rowValues: data.rowValues,
        colValues: data.colValues,
        solution: data.solution,
      });
    } catch {
      // ignore
    } finally {
      setLoading(null);
    }
  };

  if (process.env.NODE_ENV !== "development") return null;

  return (
    <div className="mb-6 rounded-lg border border-dashed border-amber-500/50 bg-amber-50 p-4 dark:bg-amber-950/20">
      <h3 className="text-sm font-bold text-amber-900 dark:text-amber-100">DEV — Theme Tester (weekly schedule preview)</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Achievement Mon / Balanced Tue & Fri / Very Challenging Wed / Throwback Thu pre-2013/14 / Stat Heavy Sat / Deep Throwback Sun pre-09/10. Click to preview (unlimited, not saved).
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {THEMES.map((t) => (
          <Button
            key={t}
            variant={activeTheme === t ? "default" : "outline"}
            size="sm"
            onClick={() => loadTheme(t)}
            disabled={loading != null}
            type="button"
          >
            {loading === t ? "Loading…" : LABELS[t]}
          </Button>
        ))}
        {preview && (
          <Button variant="ghost" size="sm" onClick={() => setPreview(null)} type="button">
            Clear preview
          </Button>
        )}
      </div>
      {preview && (
        <div className="mt-4 rounded-md border bg-background p-2">
          <p className="mb-2 text-center text-xs font-medium text-muted-foreground">
            Preview: {activeTheme ? LABELS[activeTheme] : "Unknown"} — {preview.rowTypes.join(", ")} × {preview.colTypes.join(", ")}
          </p>
          <GameGrid spec={preview} userId={null} />
        </div>
      )}
    </div>
  );
}
