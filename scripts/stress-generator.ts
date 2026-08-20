import { createAdminClient } from "../lib/db/supabase-admin";
import { loadGridDataset } from "../lib/db/grid-loader";
import { generateGrid, resolveCriterionLabel } from "../lib/grid/generator";
import { GRID_SIZE } from "../lib/grid/labels";

process.loadEnvFile(".env");

async function main() {
  const supabase = createAdminClient();
  const ds = await loadGridDataset(supabase);

  const total = 100;
  let failures = 0;
  const singletonHist: Record<number, number> = {};
  const goodHist: Record<number, number> = {};
  let clubMin = Infinity;
  let clubMax = 0;
  let checked = 0;

  for (let n = 0; n < total; n++) {
    try {
      const grid = generateGrid(ds);
      const size = GRID_SIZE;
      const clubCount = new Set([
        ...grid.rowValues.map((v, i) => (grid.rowTypes[i] === "club" ? v : null)),
        ...grid.colValues.map((v, i) => (grid.colTypes[i] === "club" ? v : null)),
      ]).size;

      const cats = [...grid.rowTypes, ...grid.colTypes].filter((c) => c !== "club");
      const hasBothAppsMinutes = cats.includes("appearances") && cats.includes("minutes");
      const hasDupeCategory = cats.some((c, i) => cats.indexOf(c) !== i);
      if (hasBothAppsMinutes || hasDupeCategory) {
        failures++;
        console.log(
          `FAIL #${n}: appearances+minutes coexisting=${hasBothAppsMinutes} dupes=${hasDupeCategory}`,
          JSON.stringify(grid.rowValues),
          JSON.stringify(grid.colValues),
        );
      }

      let singletons = 0;
      let good = 0;
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          const rowLabel = resolveCriterionLabel(ds, grid.rowTypes[i], grid.rowValues[i]);
          const colLabel = resolveCriterionLabel(ds, grid.colTypes[j], grid.colValues[j]);
          const rowSet = rowLabel === null ? new Set() : ds.members[grid.rowTypes[i]].get(rowLabel) ?? new Set();
          const colSet = colLabel === null ? new Set() : ds.members[grid.colTypes[j]].get(colLabel) ?? new Set();
          const cnt = [...rowSet].filter((p) => colSet.has(p)).length;
          if (cnt === 1) singletons++;
          if (cnt >= 3) good++;
        }
      }
      singletonHist[singletons] = (singletonHist[singletons] ?? 0) + 1;
      goodHist[good] = (goodHist[good] ?? 0) + 1;
      clubMin = Math.min(clubMin, clubCount);
      clubMax = Math.max(clubMax, clubCount);
      if (clubCount < 4 || singletons > 1 || good < 5) {
        failures++;
        console.log(
          `FAIL #${n}: clubs=${clubCount} singletons=${singletons} good=${good}`,
          JSON.stringify(grid.rowValues),
          JSON.stringify(grid.colValues),
        );
      }
      checked++;
    } catch (e) {
      failures++;
      console.log(`FAIL #${n}: threw ${(e as Error).message}`);
    }
  }

  console.log(`generated ${checked}/${total} grids, failures: ${failures}`);
  console.log("singleton-cell histogram:", JSON.stringify(singletonHist));
  console.log("good-cell(>=3) histogram:", JSON.stringify(goodHist));
  console.log("distinct clubs (incl null slot) min/max:", clubMin, "/", clubMax);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});