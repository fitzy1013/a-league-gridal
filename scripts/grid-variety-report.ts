import { createAdminClient } from "../lib/db/supabase-admin";
import { loadGridDataset } from "../lib/db/grid-loader";
import { generateGrid } from "../lib/grid/generator";
import type { Category } from "../lib/grid/types";

process.loadEnvFile(".env");

const RUNS = 200;
const WINDOW = 14; // matches generateDailyGrid's exclusion window

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
  const window = (existing ?? []).map(storedSig).map((s) => s.join("|")).slice(-WINDOW);

  const slotCounts = new Map<string, number>();
  const gridCounts = new Map<string, number>();
  let failures = 0;

  for (let i = 0; i < RUNS; i++) {
    let grid;
    try {
      grid = generateGrid(dataset, { exclude: [...window], minDiffCriteria: 2 });
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
    window.push(crits.sort().join("|"));
    if (window.length > WINDOW) window.shift();
  }

  const totalSlots = (RUNS - failures) * 6;
  const pct = (n: number, base: number) => `${((n / base) * 100).toFixed(1)}%`;
  const generated = RUNS - failures;

  console.log(`generated ${generated}/${RUNS} grids (${failures} failures), ${totalSlots} criterion slots`);
  console.log(`distinct criteria seen: ${slotCounts.size}`);

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