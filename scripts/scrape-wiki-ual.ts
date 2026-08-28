/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAdminClient } from "../lib/db/supabase-admin";
import { UAL_BASE, fetchHtml, CLUBS } from "../lib/scrape/ual";

process.loadEnvFile(".env");

/**
 * Obscurity scraper using the UAL "More information at Wikipedia" link
 * on each player's profile page, with fallback search.
 *
 * - If UAL link exists -> use it
 * - If no link exists -> attempt Wikipedia search for "(footballer)/(soccer)"
 *   variants, but ONLY accept a page that mentions an A-League club, the
 *   A-League competition, or at least "soccer"/"footballer".
 * - Fetch last month's pageviews (monthly granularity, single request
 *   per player) to minimise API calls, then score 0-100 where <=30 views
 *   = 100, then log scale: 100 - 25*log10(views/30) (30->100, 300->75,
 *   3k->50, 30k->25, 300k->0).
 * - Retries: single attempt per player up front; failures queued and retried
 *   at the end up to 5 times per player before abandoning.
 *
 * Usage: npx tsx scripts/scrape-wiki-ual.ts
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = { "user-agent": "a-league-grid-obscurity-ual/1.0" };

// Keywords that indicate the page is about an A-League player.
// All club names (lowercased) plus competition / sport markers.
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

function extractWikiTitle(html: string): string | null {
  // Matches: <a href="https://en.wikipedia.org/wiki/Brian_Kaltak" ...>More information at Wikipedia
  const m = html.match(/href="https?:\/\/en\.wikipedia\.org\/wiki\/([^"]+)"[^>]*>\s*More information at Wikipedia/i);
  if (!m) return null;
  try {
    const raw = decodeURIComponent(m[1]);
    return raw.replace(/_/g, " ");
  } catch {
    return m[1].replace(/_/g, " ");
  }
}

/** Check if a Wikipedia page mentions A-League clubs/competition or at least soccer */
async function validateWikiPage(title: string): Promise<boolean> {
  // Fetch summary + extracts via Wikipedia API.
  // Use extracts prop for full intro text.
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&explaintext&titles=${encodeURIComponent(title)}`;
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return false;
    const json: any = await res.json();
    const pages = json?.query?.pages ?? {};
    const page = Object.values(pages)[0] as any;
    if (!page || page.missing) return false;
    const text: string = (page.extract ?? "").toLowerCase();
    // Also check title itself for soccer/footballer hint (some pages have it)
    const titleLower = title.toLowerCase();
    const combined = text + " " + titleLower;
    // Must contain an A-League keyword OR at least soccer fallback if no club mention.
    // We require A-League reference if possible, but allow soccer/footballer as minimum.
    const hasALeague = ALEAGUE_KEYWORDS.some((kw) => combined.includes(kw));
    if (hasALeague) return true;
    const hasSoccer = SOCCER_FALLBACK_KEYWORDS.some((kw) => combined.includes(kw));
    return hasSoccer;
  } catch {
    return false;
  }
}

async function queryBatchExists(titles: string[]): Promise<{ present: Set<string>; ok: boolean }> {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&titles=" +
    encodeURIComponent(titles.join("|"));
  try {
    const res = await fetch(url, { headers: UA });
    if (res.status === 429 || res.status >= 500) throw new Error(String(res.status));
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

/** Fallback search when UAL has no Wikipedia link: try variants but validate */
async function findWikiTitleFallback(playerName: string): Promise<string | null> {
  const candidates = [
    playerName,
    `${playerName} (footballer)`,
    `${playerName} (soccer)`,
  ];
  // Batch check existence first (single attempt, no inline retry - will be retried at end if needed)
  const { present, ok } = await queryBatchExists(candidates);
  if (!ok) return null; // treat as no link this pass; will be retried via outer queue if needed
  for (const cand of candidates) {
    const exists = present.has(cand.toLowerCase()) || present.has(norm(cand));
    if (!exists) continue;
    const valid = await validateWikiPage(cand);
    // small throttle
    await sleep(150);
    if (valid) return cand;
  }
  return null;
}

/** Total views last complete month via monthly endpoint — single attempt, caller handles retries — minimises API calls to 1/player */
async function yearlyViews(title: string): Promise<number | null> {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  d.setDate(1); // last complete month
  const fmt = d.toISOString().slice(0, 7).replace(/-/g, "") + "01";
  const url =
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/` +
    `${encodeURIComponent(title.replace(/ /g, "_"))}/monthly/${fmt}/${fmt}`;
  try {
    const res = await fetch(url, { headers: UA });
    if (res.status === 404) return 0;
    if (res.status === 429 || res.status >= 500) {
      return null;
    }
    const json: any = await res.json();
    const items: number[] = (json?.items ?? []).map((i: any) => i.views ?? 0);
    return items.reduce((a, b) => a + b, 0);
  } catch {
    return null;
  }
}

function obscurityFromYearlyViews(views: number | null): number | null {
  if (views == null) return null;
  if (views <= 30) return 100;
  // 30->100, 300->75, 3k->50, 30k->25, 300k->0 (views = last month)
  const score = 100 - 25 * Math.log10(views / 30);
  return Math.round(Math.max(0, Math.min(100, score)));
}

async function main() {
  const supabase = createAdminClient();

  const players: { id: number; name: string; wiki_title: string | null; obscurity: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("players").select("id,name,wiki_title,obscurity").range(from, from + 999);
    players.push(...((data ?? []) as typeof players));
    if (!data || data.length < 1000) break;
  }
  console.log(`players total: ${players.length}`);

  let done = 0;
  let withLink = 0;
  let withoutLink = 0;
  let fallbackFound = 0;
  const updates: { id: number; wiki_title: string | null; wiki_views_monthly: number | null; obscurity: number | null }[] = [];
  const failedViews: { id: number; name: string; title: string }[] = [];
  const failedFallback: { id: number; name: string }[] = [];

  for (const p of players) {
    let title: string | null = null;
    let usedFallback = false;
    try {
      const html = await fetchHtml(`${UAL_BASE}/player/?player_id=${p.id}`);
      title = extractWikiTitle(html);
    } catch (e) {
      console.log(`  fetch failed for ${p.name} (${p.id}): ${e instanceof Error ? e.message : String(e)}`);
      title = null;
    }

    // Fallback when UAL has no link: attempt Wikipedia search with validation
    if (!title) {
      const fb = await findWikiTitleFallback(p.name);
      if (fb) {
        title = fb;
        usedFallback = true;
        fallbackFound++;
        console.log(`  fallback found for ${p.name} -> "${fb}"`);
      } else {
        // No fallback found or batch check failed (ok=false) -> queue for deferred retry if it was a network failure
        // We treat batch failure (null return due to ok=false) as retryable via failedFallback
        // For now check if findWikiTitleFallback returned null due to ok=false vs genuinely not found
        // We re-run queryBatchExists logic to distinguish? Simplified: queue for retry at end
        // If title still null and we didn't find fallback, we'll check again later
        // To know if it was network error, findWikiTitleFallback returns null for both cases
        // So we push to failedFallback to retry discovery at end (up to 5 times)
        // Only push if we suspect network; but pushing all not-found would waste retries
        // Instead we only push if queryBatchExists was not ok - we can't distinguish here
        // We'll attempt retry at end for all without link that we haven't scored
        // For now mark as withoutLink and push to failedFallback for later validation retry
        failedFallback.push({ id: p.id, name: p.name });
      }
    }

    let views: number | null;
    let score: number | null;
    if (!title) {
      withoutLink++;
      views = 0;
      score = 100;
      updates.push({ id: p.id, wiki_title: null, wiki_views_monthly: 0, obscurity: score });
    } else {
      withLink++;
      if (usedFallback) {
        // already logged
      }
      views = await yearlyViews(title);
      if (views == null) {
        console.log(`  views fetch failed for ${p.name} -> "${title}", queued for retry at end`);
        failedViews.push({ id: p.id, name: p.name, title });
        done++;
        await sleep(650);
        continue;
      }
      score = obscurityFromYearlyViews(views);
      updates.push({ id: p.id, wiki_title: title, wiki_views_monthly: views, obscurity: score });
      if (withLink <= 5) console.log(`  ${p.name} -> "${title}" views 365d=${views} obscurity=${score}`);
    }

    done++;
    if (done % 100 === 0) {
      console.log(`progress: ${done}/${players.length} (${withLink} with link, ${withoutLink} without, ${failedViews.length} queued views, ${failedFallback.length} queued fallback)`);
      await flush(supabase, updates.splice(0));
    }
    await sleep(650);
  }
  await flush(supabase, updates.splice(0));

  // Retry fallback discovery at end (for those without UAL link where initial batch may have failed)
  if (failedFallback.length > 0) {
    console.log(`retrying fallback discovery for ${failedFallback.length} players without UAL link...`);
    // Filter to those still without wiki_title in updates (i.e., scored as 100)
    const pendingFallback = failedFallback.filter((f) => !updates.some((u) => u.id === f.id && u.wiki_title != null));
    // Actually we need to re-process those that are in updates as withoutLink but could have fallback on retry
    // Simpler: re-attempt findWikiTitleFallback for each queued, with up to 5 tries deferred
    for (const f of pendingFallback) {
      let found: string | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        found = await findWikiTitleFallback(f.name);
        if (found) break;
        // If findWikiTitleFallback returns null due to network (ok=false), we retry after sleep
        // If it returns null because page doesn't exist / validation failed, also retry but will still be null
        await sleep(800 * (attempt + 1));
      }
      if (found) {
        console.log(`  fallback retry ok for ${f.name} -> "${found}"`);
        const views = await fetchViewsWithDeferredRetries(found);
        const score = obscurityFromYearlyViews(views ?? 0);
        // Replace the earlier withoutLink update for this player
        const idx = updates.findIndex((u) => u.id === f.id);
        if (idx !== -1) updates.splice(idx, 1);
        withoutLink = Math.max(0, withoutLink - 1);
        withLink++;
        fallbackFound++;
        updates.push({ id: f.id, wiki_title: found, wiki_views_monthly: views ?? 0, obscurity: score });
      } else {
        console.log(`  fallback still not found for ${f.name}, keeping as 100`);
      }
      await sleep(500);
    }
    await flush(supabase, updates.splice(0));
  }

  // Retry any with link but views timed out — up to 5 attempts per player, waited til end
  if (failedViews.length > 0) {
    console.log(`retrying ${failedViews.length} with link but views timed out (up to 5 attempts each)...`);
    for (const f of failedViews) {
      const views = await fetchViewsWithDeferredRetries(f.title);
      if (views == null) {
        console.log(`  still failed for ${f.name} -> "${f.title}" after 5 attempts, leaving as 100`);
        updates.push({ id: f.id, wiki_title: f.title, wiki_views_monthly: 0, obscurity: 100 });
      } else {
        const score = obscurityFromYearlyViews(views);
        console.log(`  retry ok for ${f.name} -> "${f.title}" views 365d=${views} obscurity=${score}`);
        updates.push({ id: f.id, wiki_title: f.title, wiki_views_monthly: views, obscurity: score });
      }
      await sleep(800);
    }
    await flush(supabase, updates.splice(0));
  }

  async function fetchViewsWithDeferredRetries(title: string): Promise<number | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const v = await yearlyViews(title);
      if (v != null) return v;
      const backoff = 1500 * (attempt + 1);
      console.log(`    views retry ${attempt + 1}/5 for "${title}" failed, sleeping ${backoff}ms`);
      await sleep(backoff);
    }
    return null;
  }

  function flush(supa: ReturnType<typeof createAdminClient>, batch: typeof updates) {
    if (batch.length === 0) return Promise.resolve();
    return Promise.all(
      batch.map(async (u) => {
        const { error } = await supa.from("players").update({ wiki_title: u.wiki_title, wiki_views_monthly: u.wiki_views_monthly, obscurity: u.obscurity }).eq("id", u.id);
        if (error) throw new Error(`update ${u.id}: ${error.message}`);
      }),
    );
  }

  console.log(`done: ${done} players, ${withLink} with Wikipedia link (${fallbackFound} via fallback), ${withoutLink} without (100)`);
  const dist = new Map<string, number>();
  for (const u of updates) {
    const k = u.obscurity! >= 80 ? "80+" : u.obscurity! >= 60 ? "60-79" : u.obscurity! >= 40 ? "40-59" : u.obscurity! >= 20 ? "20-39" : "0-19";
    dist.set(k, (dist.get(k) ?? 0) + 1);
  }
  console.log("obscurity distribution (this run):", [...dist.entries()].sort());
}

main().catch((e) => { console.error(e); process.exit(1); });
