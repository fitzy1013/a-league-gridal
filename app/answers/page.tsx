import Link from "next/link";
import { notFound } from "next/navigation";
import { loadGridDataset } from "@/lib/db/grid-loader";
import { cellAnswers } from "@/lib/grid/answers";
import { CATEGORY_LABELS } from "@/lib/grid/labels";
import type { Category } from "@/lib/grid/types";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export default async function AnswersPage({
  searchParams,
}: {
  searchParams: Promise<{
    gridId?: string;
    r?: string;
    c?: string;
    rowTypes?: string;
    colTypes?: string;
    rowValues?: string;
    colValues?: string;
  }>;
}) {
  const params = await searchParams;
  const r = Number(params.r);
  const c = Number(params.c);
  if (!Number.isInteger(r) || !Number.isInteger(c)) {
    notFound();
  }

  const supabase = await createClient();

  let rowTypes: Category[];
  let colTypes: Category[];
  let rowValues: string[];
  let colValues: string[];

  if (params.gridId) {
    const { getGrid } = await import("@/lib/db/queries");
    const grid = await getGrid(supabase, params.gridId);
    if (!grid) {
      notFound();
    }
    rowTypes = JSON.parse(grid.row_type) as Category[];
    colTypes = JSON.parse(grid.col_type) as Category[];
    rowValues = grid.row_values as string[];
    colValues = grid.col_values as string[];
  } else if (params.rowTypes && params.colTypes && params.rowValues && params.colValues) {
    try {
      rowTypes = JSON.parse(params.rowTypes) as Category[];
      colTypes = JSON.parse(params.colTypes) as Category[];
      rowValues = JSON.parse(params.rowValues) as string[];
      colValues = JSON.parse(params.colValues) as string[];
    } catch {
      notFound();
    }
  } else {
    notFound();
  }

  if (r < 0 || r >= rowTypes.length || c < 0 || c >= colTypes.length) {
    notFound();
  }

  const dataset = await loadGridDataset(supabase);
  const { ids, names } = cellAnswers(dataset, rowTypes[r], rowValues[r], colTypes[c], colValues[c]);
  const players = [...ids]
    .sort((a, b) => (names.get(a) ?? "").localeCompare(names.get(b) ?? ""))
    .map((id) => ({ id, name: names.get(id) ?? "Unknown" }));

  const rowLabel = rowTypes[r] === "club" ? rowValues[r] : `${rowValues[r]} (${CATEGORY_LABELS[rowTypes[r]]})`;
  const colLabel = colTypes[c] === "club" ? colValues[c] : `${colValues[c]} (${CATEGORY_LABELS[colTypes[c]]})`;

  return (
    <main className="flex min-h-screen flex-col items-center p-6">
      <div className="w-full max-w-xl">
        <Link href="/play/daily" className="text-sm font-semibold text-muted-foreground">
          ← Back to A-League Grid
        </Link>

        <h1 className="mt-6 text-2xl font-bold">Answers</h1>
        <p className="mt-1 text-muted-foreground">
          {rowLabel} <span className="mx-1">×</span> {colLabel}
        </p>

        <div className="mt-6 rounded-xl border bg-background p-6">
          {players.length === 0 ? (
            <p className="text-muted-foreground">No players match both criteria.</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                {players.length} {players.length === 1 ? "player" : "players"} fit this cell.
              </p>
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {players.map((p) => (
                  <li key={p.id} className="rounded-md bg-accent px-3 py-2 text-sm font-medium">
                    {p.name}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </main>
  );
}