import Link from "next/link";
import { Button } from "@/components/ui/button";
import DevThemeCycler from "@/app/components/grid/DevThemeCycler";
import GameGrid from "@/app/components/grid/GameGrid";
import { getTodayGrid } from "@/lib/db/queries";
import type { Category, CellSolution } from "@/lib/grid/types";
import { createClient } from "@/lib/supabase/server";
import { todaySydneyDate } from "@/lib/dates";
import { themeForDate, themeLabel } from "@/lib/grid/generate-daily";

export const instant = false;

export default async function DailyPage() {
  const supabase = await createClient();
  const today = todaySydneyDate();
  const grid = await getTodayGrid(supabase, today);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!grid) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <h1 className="text-2xl font-bold">No grid published yet</h1>
        <p className="max-w-md text-muted-foreground">
          The daily grid for {today} hasn&apos;t been generated. The scheduled generator runs at
          04:00 AEST.
        </p>
        {process.env.NODE_ENV === "development" && (
          <Button asChild>
            <Link href="/play/unlimited">Play Unlimited</Link>
          </Button>
        )}
      </div>
    );
  }

  const spec = {
    gridId: grid.id,
    mode: "daily" as const,
    date: today,
    rowTypes: JSON.parse(grid.row_type) as Category[],
    colTypes: JSON.parse(grid.col_type) as Category[],
    rowValues: grid.row_values as string[],
    colValues: grid.col_values as string[],
    solution: grid.solution as CellSolution[],
  };

  const theme = themeForDate(today);

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-xl">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium">Theme: {themeLabel(theme)}</span>
        </div>
        {process.env.NODE_ENV === "development" && <DevThemeCycler />}
        <GameGrid spec={spec} userId={user?.id ?? null} />
      </div>
    </div>
  );
}