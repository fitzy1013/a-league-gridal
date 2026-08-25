import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlayer, getGrid } from "@/lib/db/queries";
import {
  describeStatValue,
  playerSatisfiesClubStatCell,
  playerSatisfiesCriterion,
} from "@/lib/grid/validate";
import { isPairAwareCategory, type BandedCategory, type Category } from "@/lib/grid/types";
import { createClient } from "@/lib/supabase/server";

type SupabaseClientLike = SupabaseClient;

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
  let gridRow: Awaited<ReturnType<typeof getGrid>> | null = null;

  if (typeof gridId === "string" && gridId) {
    gridRow = await getGrid(supabase, gridId);
    if (!gridRow) {
      return NextResponse.json({ error: "grid not found" }, { status: 404 });
    }
    rTypes = JSON.parse(gridRow.row_type) as Category[];
    cTypes = JSON.parse(gridRow.col_type) as Category[];
    rValues = gridRow.row_values as string[];
    cValues = gridRow.col_values as string[];
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

  // Club x pair-aware-stat cells are checked jointly: the stat band must be
  // met with the stats recorded at that club, not career-wide. Grids stamped
  // with an older ruleset keep their original career-wide semantics. Every
  // other combination is two independent axis checks.
  const rowType = rTypes[rowIdx!];
  const colType = cTypes[colIdx!];
  const rowValue = rValues[rowIdx!];
  const colValue = cValues[colIdx!];
  const legacyPairing =
    typeof gridId === "string" && gridId ? (gridRow?.ruleset ?? "legacy") !== "v2" : false;  let correct: boolean;
  let hint: string | null = null;

  const clubAxis =
    !legacyPairing && rowType === "club" && isPairAwareCategory(colType)
      ? { clubName: rowValue, statCat: colType as BandedCategory, statLabel: colValue, onRow: true }
      : !legacyPairing && colType === "club" && isPairAwareCategory(rowType)
        ? { clubName: colValue, statCat: rowType as BandedCategory, statLabel: rowValue, onRow: false }
        : null;

  if (clubAxis) {
    correct = await playerSatisfiesClubStatCell(
      supabase,
      playerId!,
      clubAxis.clubName,
      clubAxis.statCat,
      clubAxis.statLabel,
    );
  } else {
    const [rowOk, colOk] = await Promise.all([
      playerSatisfiesCriterion(supabase, playerId!, rowType, rowValue),
      playerSatisfiesCriterion(supabase, playerId!, colType, colValue),
    ]);
    correct = rowOk && colOk;

    const isClubClubCell = rowType === "club" && colType === "club";
    if (!correct && !isClubClubCell) {
      hint = await buildHint(supabase, playerId!, [
        ...(rowType !== "club"
          ? [{ category: rowType, label: rowValue }]
          : [{ category: "club" as Category, label: rowValue }]),
        ...(colType !== "club"
          ? [{ category: colType, label: colValue }]
          : [{ category: "club" as Category, label: colValue }]),
      ]);
    }
  }

  if (!correct && !hint && clubAxis) {
    // Club x Stat miss where the player isn't even at the club.
    hint = await buildHint(supabase, playerId!, [
      {
        category: clubAxis.statCat,
        label: clubAxis.statLabel,
        clubName: clubAxis.clubName,
      },
    ]);
  }

  return NextResponse.json(hint ? { correct, hint } : { correct });

  type HintCriterion = { category: Category; label: string; clubName?: string };

  async function buildHint(
    db: SupabaseClientLike,
    pid: number,
    criteria: HintCriterion[],
  ): Promise<string | null> {
    const name =
      (
        (await getPlayer(db, pid)) as { name?: string } | null
      )?.name ?? `Player #${pid}`;
    const parts: string[] = [];
    for (const c of criteria) {
      if (c.category === "club") {
        const played = await playerSatisfiesCriterion(db, pid, "club", c.label);
        parts.push(played ? `${name} played for ${c.label}` : `${name} never played for ${c.label}`);
        continue;
      }
      const phrase = await describeStatValue(
        db,
        pid,
        name,
        c.category,
        c.label,
        c.clubName,
      );
      if (phrase) parts.push(phrase);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }
}