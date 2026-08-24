import { createAdminClient } from "../lib/db/supabase-admin";
import { loadGridDataset } from "../lib/db/grid-loader";
import { generateGrid } from "../lib/grid/generator";
import { cellAnswers } from "../lib/grid/answers";
import { CLUB_WEIGHTS } from "../lib/grid/generate-daily";
import type { Category } from "../lib/grid/types";

process.loadEnvFile(".env");

const RUNS = 400;
const WINDOW = 14; // matches generateDailyGrid's exclusion window
const COOLDOWN_GRIDS = 10; // matches generateDailyGrid
const MAX_CLUB_USES = 5; // matches generateDailyGrid
const RARE_SPACING_GRIDS = 3; // matches generateDailyGrid

function cooledOut(window: string[][]): string[] {
  const uses = new Map<string, number>();
  // window is oldest-first; the cooldown looks at the most recent grids
  for (const sig of window.slice(-COOLDOWN_GRIDS)) {
    for (const crit of sig) {
      if (crit.startsWith("club:")) {
        uses.set(crit, (uses.get(crit) ?? 0) + 1);
      }
    }
  }
  return [...uses]
    .filter(([, n]) => n >= MAX_CLUB_USES)
    .map(([crit]) => crit.slice("club:".length));
}

/** Rare clubs present in the most recent grids must sit out (spacing rule). */
function spacedOut(window: string[][]): string[] {
  const seen = new Set<string>();
  for (const sig of window.slice(-RARE_SPACING_GRIDS)) {
    for (const crit of sig) {
      if (crit.startsWith("club:") && CLUB_WEIGHTS[crit.slice(5)] != null) {
        seen.add(crit.slice(5));
      }
    }
  }
  return [...seen];
}

function storedSig(g: {
  row_type: string;
  col_type: string;
  row_values: string[];
  col_values: string[];
}): string[] {
  const rt = JSON.parse(g.row_type) as Category[];
  const ct = JSON.parse(g.col_type) as Category[];
  return [
    ...rt.map((c, i) => `${c}:${g.row_values[i]}`),
    ...ct.map((c, i) => `${c}:${g.col_values[i]}`),
  ].sort();
}

async function main() {
  const supabase = createAdminClient();
  const dataset = await loadGridDataset(supabase);

  const { data: existing } = await supabase
    .from("grids")
    .select("row_type,col_type,row_values,col_values");
  const window = (existing ?? []).map(storedSig).slice(-WINDOW);

  const slotCounts = new Map<string, number>();
  const gridCounts = new Map<string, number>();
  const rareSeenAt = new Map<string, number[]>();
  const clubDist = new Map<number, number>();
  const fatHist = new Map<number, number>();
  let failures = 0;

  for (let i = 0; i < RUNS; i++) {
    let grid;
    try {
      // stat-criterion rotation: anything used in the recent window sits out
      const banned = new Set<string>();
      for (const sig of window) {
        for (const crit of sig) {
          if (!crit.startsWith("club:")) banned.add(crit);
        }
      }
      grid = generateGrid(dataset, {
        exclude: window.map((s) => s.join("|")),
        minDiffCriteria: 2,
        excludeClubs: [...cooledOut(window), ...spacedOut(window)],
        excludeCriteria: [...banned],
        clubWeights: CLUB_WEIGHTS,
      });
    } catch {
      failures++;
      continue;
    }
    const crits = [
      ...grid.rowTypes.map((c, j) => `${c}:${grid.rowValues[j]}`),
      ...grid.colTypes.map((c, j) => `${c}:${grid.colValues[j]}`),
    ];
    for (const c of crits) slotCounts.set(c, (slotCounts.get(c) ?? 0) + 1);
    for (const c of new Set(crits)) gridCounts.set(c, (gridCounts.get(c) ?? 0) + 1);
    for (const crit of crits) {
      if (crit.startsWith("club:") && CLUB_WEIGHTS[crit.slice(5)] != null) {
        const name = crit.slice(5);
        const list = rareSeenAt.get(name) ?? [];
        list.push(i);
        rareSeenAt.set(name, list);
      }
    }

    // club-count + fat-cell tracking
    const clubCrits = crits.filter((c) => c.startsWith("club:"));
    clubDist.set(clubCrits.length, (clubDist.get(clubCrits.length) ?? 0) + 1);
    let fatCells = 0;
    for (let r = 0; r < grid.rowValues.length; r++) {
      for (let c = 0; c < grid.colValues.length; c++) {
        const n = cellAnswers(
          dataset,
          grid.rowTypes[r],
          grid.rowValues[r],
          grid.colTypes[c],
          grid.colValues[c],
        ).ids.size;
        if (n > 50) fatCells++;
      }
    }
    fatHist.set(fatCells, (fatHist.get(fatCells) ?? 0) + 1);

    window.push(crits.sort());
    if (window.length > WINDOW) window.shift();
  }

  console.log("== rare-club spacing (grids between appearances) ==");
  for (const [name, idxs] of rareSeenAt) {
    const gaps = idxs.slice(1).map((v, k) => v - idxs[k]);
    console.log(
      `${name.padEnd(26)} min ${Math.min(...gaps, RARE_SPACING_GRIDS + 1)}  avg ${(idxs.length ? (RUNS / idxs.length) : 0).toFixed(1)}  appearances ${idxs.length}`,
    );
  }

  const totalSlots = (RUNS - failures) * 9;
  const pct = (n: number, base: number) => `${((n / base) * 100).toFixed(1)}%`;
  const generated = RUNS - failures;

  console.log(`generated ${generated}/${RUNS} grids (${failures} failures), ${totalSlots} criterion slots`);
  console.log(`distinct criteria seen: ${slotCounts.size}`);

  console.log("\n== club-count distribution ==");
  for (const [n, count] of [...clubDist.entries()].sort()) {
    console.log(`${n} clubs: ${count} grids (${pct(count, generated)})`);
  }

  console.log("\n== fat cells (>50 answers) per grid ==");
  for (const [n, count] of [...fatHist.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`${n} fat cells: ${count} grids (${pct(count, generated)})`);
  }

  const catTotals = new Map<string, number>();
  for (const [crit, n] of slotCounts) {
    const cat = crit.split(":")[0];
    catTotals.set(cat, (catTotals.get(cat) ?? 0) + n);
  }
  console.log("\n== category share of slots ==");
  for (const [cat, n] of [...catTotals].sort((a, b) => b[1] - a[1])) {
    console.log(`${cat.padEnd(12)} ${String(n).padStart(4)}  ${pct(n, totalSlots)}`);
  }

  console.log("\n== clubs (appearances across all grids) ==");
  const clubs = [...slotCounts].filter(([c]) => c.startsWith("club:")).sort((a, b) => b[1] - a[1]);
  for (const [crit, n] of clubs) {
    const label = crit.slice(5);
    console.log(`${label.padEnd(28)} ${String(n).padStart(4)}  ${pct(n, totalSlots)}  in ${pct(gridCounts.get(crit) ?? 0, generated)} of grids`);
  }

  console.log("\n== bands (appearances across all grids) ==");
  const bands = [...slotCounts].filter(([c]) => !c.startsWith("club:")).sort((a, b) => b[1] - a[1]);
  for (const [crit, n] of bands) {
    const label = crit.replace(":", " ");
    console.log(`${label.padEnd(28)} ${String(n).padStart(4)}  ${pct(n, totalSlots)}  in ${pct(gridCounts.get(crit) ?? 0, generated)} of grids`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});