/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAdminClient } from "../lib/db/supabase-admin";
import { CLUBS } from "../lib/scrape/ual";

process.loadEnvFile(".env");

/**
 * Alternate script: checks every player currently scored obscurity=100
 * to see if they were defaulted (no wiki found or views fetch failed)
 * vs truly obscure.
 *
 * - For wiki_title == null: tries fallback search (footballer/soccer variants)
 *   with A-League/soccer validation. If a valid page is found, refetches
 *   last month views and recomputes obscurity (<=30 → 100 else 100-25*log10(views/30)).
 * - For wiki_title != null but wiki_views_monthly == 0 or obscurity==100:
 *   refetches views for that title (honoring 429 Retry-After) to see if
 *   views >30 (should be <100 obscurity).
 *
 * Does NOT write to DB by default (dry-run). Pass --write to update.
 * Prints every 100-scored player checked and final summary of likely-defaulted.
 *
 * Usage:
 *   npx tsx scripts/check-obscurity-100.ts           # dry-run, report only
 *   npx tsx scripts/check-obscurity-100.ts --write   # also update DB for corrections
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = { "user-agent": "a-league-grid-obscurity-check/1.0" };

const ALEAGUE_KEYWORDS = [
  ...CLUBS.map((c) => c.name.toLowerCase()),
  "a-league",
  "a league",
  "aleague",
  "isuzu ute",
  "afc champions league",
];
const SOCCER_FALLBACK_KEYWORDS = ["soccer", "footballer", "association football"];
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

async function queryBatchExists(titles: string[]): Promise<{ present: Set<string>; ok: boolean }> {
  const url = "https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&titles=" + encodeURIComponent(titles.join("|"));
  try {
    const res = await fetch(url, { headers: UA });
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after") || "2");
      await sleep(ra * 1000 + 500);
      throw new Error(String(res.status));
    }
    if (res.status >= 500) throw new Error(String(res.status));
    const json: any = await res.json();
    const present = new Set<string>();
    for (const p of Object.values(json?.query?.pages ?? {}) as any[]) {
      if (!p.missing) {
        present.add(String(p.title).toLowerCase());
        present.add(norm(String(p.title)));
      }
    }
    return { present, ok: true };
  } catch {
    return { present: new Set(), ok: false };
  }
}

async function validateWikiPage(title: string): Promise<boolean> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&explaintext&titles=${encodeURIComponent(title)}`;
  try {
    const res = await fetch(url, { headers: UA });
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after") || "2");
      await sleep(ra * 1000 + 500);
      return false;
    }
    if (!res.ok) return false;
    const json: any = await res.json();
    const pages = json?.query?.pages ?? {};
    const page = Object.values(pages)[0] as any;
    if (!page || page.missing) return false;
    const text: string = (page.extract ?? "").toLowerCase();
    const combined = text + " " + title.toLowerCase();
    const hasALeague = ALEAGUE_KEYWORDS.some((kw) => combined.includes(kw));
    if (hasALeague) return true;
    const hasSoccer = SOCCER_FALLBACK_KEYWORDS.some((kw) => combined.includes(kw));
    return hasSoccer;
  } catch {
    return false;
  }
}

async function findWikiTitleFallback(playerName: string): Promise<string | null> {
  const candidates = [playerName, `${playerName} (footballer)`, `${playerName} (soccer)`];
  const { present, ok } = await queryBatchExists(candidates);
  if (!ok) return null;
  for (const cand of candidates) {
    const exists = present.has(cand.toLowerCase()) || present.has(norm(cand));
    if (!exists) continue;
    const valid = await validateWikiPage(cand);
    await sleep(300);
    if (valid) return cand;
  }
  return null;
}

async function yearlyViews(title: string): Promise<number | null> {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
  const fmt = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}01`;
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g, "_"))}/monthly/${fmt(start)}/${fmt(end)}`;
  try {
    const res = await fetch(url, { headers: UA });
    if (res.status === 404) return 0;
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after") || "5");
      await sleep(ra * 1000 + 500);
      return null;
    }
    if (res.status >= 500) return null;
    const json: any = await res.json();
    const items: any[] = json?.items ?? [];
    const targetTs = fmt(start) + "00";
    const hit = items.find((i) => String(i.timestamp) === targetTs);
    if (hit) return hit.views ?? 0;
    if (items.length === 1) return items[0].views ?? 0;
    const full = items.filter((i) => String(i.timestamp) !== fmt(end) + "00");
    if (full.length > 0) return full.reduce((a: number, b: any) => a + (b.views ?? 0), 0);
    return items.reduce((a: number, b: any) => a + (b.views ?? 0), 0);
  } catch {
    return null;
  }
}

function obscurityFromViews(views: number | null): number | null {
  if (views == null) return null;
  if (views <= 30) return 100;
  const score = 100 - 25 * Math.log10(views / 30);
  return Math.round(Math.max(0, Math.min(100, score)));
}

async function fetchViewsWithRetries(title: string): Promise<number | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const v = await yearlyViews(title);
    if (v != null) return v;
    await sleep(3000 * (attempt + 1) + Math.floor(Math.random() * 500));
  }
  return null;
}

async function main() {
  const write = process.argv.includes("--write");
  const supabase = createAdminClient();

  // Load all players with obscurity=100
  const all: { id: number; name: string; wiki_title: string | null; wiki_views_monthly: number | null; obscurity: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("players").select("id,name,wiki_title,wiki_views_monthly,obscurity").eq("obscurity", 100).range(from, from + 999);
    if (error) throw new Error(`load 100s: ${error.message}`);
    all.push(...((data ?? []) as typeof all));
    if (!data || data.length < 1000) break;
  }
  console.log(`players with obscurity=100: ${all.length} (write=${write})`);
  if (all.length === 0) return;

  let checked = 0;
  let true100 = 0;
  let likelyDefaulted: { id: number; name: string; oldTitle: string | null; oldViews: number | null; newTitle: string | null; newViews: number | null; newObscurity: number | null; reason: string }[] = [];
  let still100AfterRefetch = 0;
  let noWikiFound = 0;
  let fetchFailed = 0;

  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    let newTitle: string | null = p.wiki_title;
    let newViews: number | null = null;
    let reason = "";

    if (!p.wiki_title) {
      // Try to find a valid wiki page now (with throttled validation)
      let found: string | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        found = await findWikiTitleFallback(p.name);
        if (found) break;
        await sleep(1500);
      }
      if (!found) {
        noWikiFound++;
        reason = "no valid wiki page found (still 100)";
        true100++;
        console.log(`  [${i + 1}/${all.length}] ${p.name} (${p.id}) wiki=NULL → no page found → stays 100`);
      } else {
        newTitle = found;
        newViews = await fetchViewsWithRetries(found);
        if (newViews == null) {
          fetchFailed++;
          reason = `fallback "${found}" but views fetch failed after 5 retries → stays 100`;
          console.log(`  [${i + 1}/${all.length}] ${p.name} (${p.id}) wiki=NULL → fallback "${found}" views FETCH FAILED → stays 100`);
          true100++;
        } else {
          const newObs = obscurityFromViews(newViews);
          if (newObs != null && newObs < 100) {
            reason = `fallback "${found}" views=${newViews} → obscurity ${newObs} (was defaulted)`;
            likelyDefaulted.push({ id: p.id, name: p.name, oldTitle: p.wiki_title, oldViews: p.wiki_views_monthly, newTitle, newViews, newObscurity: newObs, reason });
            console.log(`  [${i + 1}/${all.length}] ${p.name} (${p.id}) wiki=NULL → fallback "${found}" views=${newViews} obscurity=${newObs} *** LIKELY DEFAULTED ***`);
          } else {
            still100AfterRefetch++;
            true100++;
            console.log(`  [${i + 1}/${all.length}] ${p.name} (${p.id}) wiki=NULL → fallback "${found}" views=${newViews} obscurity=${newObs} → still 100`);
            // Still 100 but now we have a title — count as correction if we write
            if (newObs === 100) {
              likelyDefaulted.push({ id: p.id, name: p.name, oldTitle: p.wiki_title, oldViews: p.wiki_views_monthly, newTitle, newViews, newObscurity: newObs, reason: `fallback "${found}" but still 100 (views=${newViews})` });
            }
          }
        }
      }
    } else {
      // Has wiki_title but scored 100 — re-fetch views to see if defaulted due to 0/fetch failure
      newViews = await fetchViewsWithRetries(p.wiki_title);
      if (newViews == null) {
        fetchFailed++;
        reason = `wiki "${p.wiki_title}" views fetch failed after 5 retries → stays 100`;
        console.log(`  [${i + 1}/${all.length}] ${p.name} (${p.id}) wiki="${p.wiki_title}" views=${p.wiki_views_monthly} → refetch FAILED → stays 100`);
        true100++;
      } else {
        const newObs = obscurityFromViews(newViews);
        const oldViews = p.wiki_views_monthly;
        if (newViews !== oldViews || newObs !== 100) {
          if (newObs != null && newObs < 100) {
            reason = `wiki "${p.wiki_title}" oldViews=${oldViews} → newViews=${newViews} → obscurity ${newObs} (was defaulted 100)`;
            likelyDefaulted.push({ id: p.id, name: p.name, oldTitle: p.wiki_title, oldViews, newTitle: p.wiki_title, newViews, newObscurity: newObs, reason });
            console.log(`  [${i + 1}/${all.length}] ${p.name} (${p.id}) wiki="${p.wiki_title}" views ${oldViews} → ${newViews} obscurity=${newObs} *** LIKELY DEFAULTED ***`);
          } else {
            still100AfterRefetch++;
            true100++;
            console.log(`  [${i + 1}/${all.length}] ${p.name} (${p.id}) wiki="${p.wiki_title}" views ${oldViews} → ${newViews} obscurity=${newObs} → still 100`);
          }
        } else {
          // Views unchanged and still 100 — truly obscure or low-traffic
          true100++;
          console.log(`  [${i + 1}/${all.length}] ${p.name} (${p.id}) wiki="${p.wiki_title}" views=${newViews} obscurity=${newObs} → stays 100 (verified)`);
        }
      }
    }

    checked++;
    // Throttle: 800ms between players + pause every 10
    await sleep(800);
    if ((i + 1) % 10 === 0) {
      console.log(`  -- throttling pause after 10 checks -- progress ${i + 1}/${all.length} (likelyDefaulted=${likelyDefaulted.length}, true100=${true100})`);
      await sleep(3000);
    }

    // Optionally write correction immediately if --write
    if (write && likelyDefaulted.length > 0 && likelyDefaulted[likelyDefaulted.length - 1]?.id === p.id) {
      const last = likelyDefaulted[likelyDefaulted.length - 1];
      if (last.newObscurity != null && last.newObscurity < 100) {
        const { error } = await supabase.from("players").update({ wiki_title: last.newTitle, wiki_views_monthly: last.newViews, obscurity: last.newObscurity }).eq("id", p.id);
        if (error) console.log(`    WRITE FAILED for ${p.name}: ${error.message}`);
        else console.log(`    UPDATED DB for ${p.name} → obscurity ${last.newObscurity}`);
        await sleep(300);
      }
    }
  }

  console.log("\n=== CHECK SUMMARY ===");
  console.log(`checked: ${checked}`);
  console.log(`true 100 (verified low/no traffic or no page): ${true100}`);
  console.log(`still 100 after refetch but had title: ${still100AfterRefetch}`);
  console.log(`no wiki found: ${noWikiFound}`);
  console.log(`fetch failed: ${fetchFailed}`);
  console.log(`likely DEFAULTED (would change from 100): ${likelyDefaulted.filter((x) => (x.newObscurity ?? 100) < 100).length}`);
  if (likelyDefaulted.length > 0) {
    console.log("\n--- LIKELY DEFAULTED LIST (all) ---");
    for (const d of likelyDefaulted) {
      console.log(`${d.name} (${d.id}) | old wiki:${d.oldTitle ?? "NULL"} views:${d.oldViews ?? "NULL"} → new wiki:"${d.newTitle}" views:${d.newViews} obscurity:${d.newObscurity} | ${d.reason}`);
    }
    const needUpdate = likelyDefaulted.filter((x) => (x.newObscurity ?? 100) < 100);
    if (needUpdate.length > 0 && !write) {
      console.log(`\nDry-run only. Re-run with --write to update ${needUpdate.length} players in DB.`);
    }
  }
  console.log("=== END CHECK ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
