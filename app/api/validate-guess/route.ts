import { NextRequest, NextResponse } from "next/server";
import { getGrid } from "@/lib/db/queries";
import { playerSatisfiesCriterion } from "@/lib/grid/validate";
import type { Category } from "@/lib/grid/types";
import { createClient } from "@/lib/supabase/server";

/**
 * Validates whether a player fits a grid cell. Accepts either a stored
 * `gridId` (daily — criteria loaded from the DB) or explicit criteria arrays
 * (unlimited — no stored grid). Returns { correct: boolean }.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    gridId?: string;
    rowIdx?: number;
    colIdx?: number;
    playerId?: number;
    rowTypes?: Category[];
    colTypes?: Category[];
    rowValues?: string[];
    colValues?: string[];
  } | null;
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { gridId, rowIdx, colIdx, playerId } = body;
  if (
    !Number.isInteger(rowIdx) ||
    !Number.isInteger(colIdx) ||
    !Number.isInteger(playerId)
  ) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const supabase = await createClient();

  let rTypes = body.rowTypes;
  let cTypes = body.colTypes;
  let rValues = body.rowValues;
  let cValues = body.colValues;

  if (typeof gridId === "string" && gridId) {
    const grid = await getGrid(supabase, gridId);
    if (!grid) {
      return NextResponse.json({ error: "grid not found" }, { status: 404 });
    }
    rTypes = JSON.parse(grid.row_type) as Category[];
    cTypes = JSON.parse(grid.col_type) as Category[];
    rValues = grid.row_values as string[];
    cValues = grid.col_values as string[];
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

  if (rowIdx! < 0 || rowIdx! >= rTypes.length || colIdx! < 0 || colIdx! >= cTypes.length) {
    return NextResponse.json({ error: "cell out of range" }, { status: 400 });
  }

  const [rowOk, colOk] = await Promise.all([
    playerSatisfiesCriterion(supabase, playerId!, rTypes[rowIdx!], rValues[rowIdx!]),
    playerSatisfiesCriterion(supabase, playerId!, cTypes[colIdx!], cValues[colIdx!]),
  ]);

  return NextResponse.json({ correct: rowOk && colOk });
}