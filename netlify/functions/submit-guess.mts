import type { Config } from "@netlify/functions";
import { getGrid, loadGridDataset } from "../../lib/db/grid-loader";
import { createAdminClient } from "../../lib/db/supabase-admin";
import { playerSatisfies } from "../../lib/grid/generator";
import type { Category } from "../../lib/grid/types";

export const config: Config = { path: "/api/submit-guess" };

function parseTypes(raw: string): Category[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readValues(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  return [];
}

const handler = async (req: Request) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), { status: 400 });
  }

  const gridId = (body as Record<string, unknown>)?.gridId as string | undefined;
  if (!gridId) {
    return new Response(JSON.stringify({ error: "gridId required" }), { status: 400 });
  }

  const supabase = createAdminClient();
  const grid = await getGrid(supabase, gridId);
  if (!grid) {
    return new Response(JSON.stringify({ error: "grid not found" }), { status: 404 });
  }

  const rowTypes = parseTypes(grid.row_type);
  const colTypes = parseTypes(grid.col_type);
  const rowValues = readValues(grid.row_values);
  const colValues = readValues(grid.col_values);

  // Reveal mode: return the stored answer key.
  if ((body as Record<string, unknown>).reveal === true) {
    return new Response(
      JSON.stringify({ correct: undefined, reveal: true, solution: grid.solution }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  const rowIdx = Number((body as Record<string, unknown>).rowIdx);
  const colIdx = Number((body as Record<string, unknown>).colIdx);
  const playerId = Number((body as Record<string, unknown>).playerId);

  if (
    !Number.isInteger(rowIdx) ||
    !Number.isInteger(colIdx) ||
    !Number.isInteger(playerId) ||
    rowIdx < 0 || rowIdx >= rowTypes.length ||
    colIdx < 0 || colIdx >= colTypes.length
  ) {
    return new Response(JSON.stringify({ error: "invalid cell or player" }), { status: 400 });
  }

  const dataset = await loadGridDataset(supabase);

  const rowCategory = rowTypes[rowIdx];
  const colCategory = colTypes[colIdx];
  const rowLabel = rowValues[rowIdx];
  const colLabel = colValues[colIdx];

  const correct =
    playerSatisfies(dataset, rowCategory, rowLabel, playerId) &&
    playerSatisfies(dataset, colCategory, colLabel, playerId);

  return new Response(
    JSON.stringify({
      correct,
      playerName: dataset.players.get(playerId)?.name ?? null,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};

export default handler;