import { NextRequest, NextResponse } from "next/server";
import { loadGridDataset } from "@/lib/db/grid-loader";
import { cellAnswers } from "@/lib/grid/answers";
import type { Category } from "@/lib/grid/types";
import { createClient } from "@/lib/supabase/server";

/**
 * Returns the live answer counts (and matching players) for one or more grid
 * cells. Accepts either a stored `gridId` (daily) or explicit criteria arrays
 * (unlimited). Used by the result summary so each cell can link to a page
 * listing every correct answer.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    gridId?: string;
    cells?: [number, number][];
    rowTypes?: Category[];
    colTypes?: Category[];
    rowValues?: string[];
    colValues?: string[];
  } | null;
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const supabase = await createClient();

  let rTypes = body.rowTypes;
  let cTypes = body.colTypes;
  let rValues = body.rowValues;
  let cValues = body.colValues;
  // Grids generated before per-club pairing keep career-wide semantics.
  let legacyPairing = false;

  if (typeof body.gridId === "string" && body.gridId) {
    const { getGrid } = await import("@/lib/db/queries");
    const grid = await getGrid(supabase, body.gridId);
    if (!grid) {
      return NextResponse.json({ error: "grid not found" }, { status: 404 });
    }
    rTypes = JSON.parse(grid.row_type) as Category[];
    cTypes = JSON.parse(grid.col_type) as Category[];
    rValues = grid.row_values as string[];
    cValues = grid.col_values as string[];
    legacyPairing = grid.ruleset !== "v2";
  }

  if (
    !Array.isArray(rTypes) ||
    !Array.isArray(cTypes) ||
    !Array.isArray(rValues) ||
    !Array.isArray(cValues) ||
    rTypes.length !== rValues.length ||
    cTypes.length !== cValues.length
  ) {
    return NextResponse.json({ error: "missing criteria" }, { status: 400 });
  }

  const size = rTypes.length;
  const requested = Array.isArray(body.cells) && body.cells.length > 0 ? body.cells : [];
  const wanted: [number, number][] =
    requested.length > 0
      ? requested.filter(([r, c]) => r >= 0 && r < size && c >= 0 && c < size)
      : Array.from({ length: size }, (_, r) =>
          Array.from({ length: size }, (_, c) => [r, c] as [number, number]),
        ).flat();

  const dataset = await loadGridDataset(supabase);

  const cells = wanted.map(([r, c]) => {
    const { ids, names } = cellAnswers(
      dataset,
      rTypes![r],
      rValues![r],
      cTypes![c],
      cValues![c],
      legacyPairing,
    );
    const players = [...ids]
      .sort((a, b) => (names.get(a) ?? "").localeCompare(names.get(b) ?? ""))
      .map((id) => ({ id, name: names.get(id) ?? "Unknown" }));
    return { r, c, count: players.length, players };
  });

  return NextResponse.json({ cells });
}