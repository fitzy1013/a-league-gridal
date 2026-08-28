/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAdminClient } from "../lib/db/supabase-admin";
import { CLUBS } from "../lib/scrape/ual";

process.loadEnvFile(".env");

/**
 * Resolves every player's English Wikipedia article, fetches the last 365
 * days of pageviews, and stores a 0-100 obscurity rating on players.
 *
 * Resolution order: manual overrides -> exact title -> "(footballer)" /
 * "(soccer)" variants -> accent-insensitive match. Each resolved title is
 * validated to ensure the page mentions an A-League club, the A-League
 * competition, or at least is a soccer player page. Unresolved or
 * invalid players score as fully obscure (100).
 *
 * Retries: single attempt per player up front; failures queued and retried
 * at the end up to 5 times per player before abandoning.
 *
 * Usage: npx tsx scripts/scrape-wiki.ts
 */

const OVERRIDES: Record<string, string> = {
  "Will Dobson": "Will Dobson (soccer)",
  "Tom Willis": "Tom Willis (soccer)",
  "Michael Baird": "Michael Baird (soccer)",
  "Andy Todd": "Andy Todd (footballer, born 1974)",
  "Carlos Hernandez": "Carlos Hernández (footballer, born 1982)",
};

const ALEAGUE_KEYWORDS = [
  ...CLUBS.map((c) => c.name.toLowerCase()),
  "a-league",
  "a league",
  "aleague",
  "isuzu ute",
];
const SOCCER_FALLBACK_KEYWORDS = ["soccer", "footballer", "association football"];

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = { "user-agent": "a-league-grid-obscurity/1.0 (contact via github)" };

async function queryBatch(chunk: string[]): Promise<{ present: Set<string>; ok: boolean }> {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&titles=" +
    encodeURIComponent(chunk.join("|"));
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

async function validateWikiPage(title: string): Promise<boolean> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&explaintext&titles=${encodeURIComponent(title)}`;
  try {
    const res = await fetch(url, { headers: UA });
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

/** Total views last 365 days via daily endpoint — single attempt, deferred retries handled by caller */
async function yearlyViews(title: string): Promise<number | null> {
  const end = new Date();
  end.setDate(end.getDate() - 1); // yesterday
  const start = new Date(end);
  start.setDate(start.getDate() - 364);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const url =
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/` +
    `${encodeURIComponent(title)}/daily/${fmt(start)}/${fmt(end)}`;
  try {
    const res = await fetch(url, { headers: UA });
    if (res.status === 404) return 0;
    if (res.status === 429 || res.status >= 500) return null;
    const json: any = await res.json();
    const items: number[] = (json?.items ?? []).map((i: any) => i.views ?? 0);
    return items.reduce((a, b) => a + b, 0);
  } catch {
    return null;
  }
}

function obscurityFromViews(views: number | null): number | null {
  if (views == null) return null;
  if (views <= 0) return 100;
  // For 365-day totals: <100 -> 100, 1k->75, 10k->50, 100k->25, 1M->0
  // Keeps log-scale inverse; 365-day totals are ~12x monthly but mapping still useful.
  // If views are yearly, divide by ~12 to approximate original monthly scale? Not needed.
  // Use yearly formula: 100 -25*log10(views/100) if you want more spread, but keep legacy for compatibility.
  // We'll use yearly formula to keep distribution sensible for yearly totals.
  if (views < 100) return 100;
  return Math.round(Math.max(0, Math.min(100, 100 - 25 * Math.log10(views / 100))));
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

async function main() {
  const supabase = createAdminClient();

  const players: { id: number; name: string; wiki_title: string | null; obscurity: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("players")
      .select("id,name,wiki_title,obscurity")
      .range(from, from + 999);
    players.push(...((data ?? []) as typeof players));
    if (!data || data.length < 1000) break;
  }
  const pending = players.filter((p) => p.obscurity == null);
  console.log(`players needing obscurity: ${pending.length}`);
  if (pending.length === 0) return;

  // ---- Stage 1-3: resolve titles ----
  const names = pending.map((p) => ({
    id: p.id,
    name: p.name,
    title: OVERRIDES[p.name] ?? null,
  }));

  const resolved = new Map<number, string>();
  for (const n of names) if (n.title) resolved.set(n.id, n.title);

  // Track batches that failed due to network so we can retry at end
  const failedBatches: { suffix: string; chunk: typeof names }[] = [];

  // exact + variant rounds
  for (const suffix of ["", " (footballer)", " (soccer)"]) {
    const remaining = names.filter((n) => !resolved.has(n.id));
    if (remaining.length === 0) break;
    console.log(`resolving round "${suffix || "exact"}": ${remaining.length}`);
    for (let i = 0; i < remaining.length; i += 25) {
      const chunk = remaining.slice(i, i + 25);
      const probeTitles = chunk.map((n) => n.title ?? `${n.name}${suffix}`);
      const { present, ok } = await queryBatch(probeTitles);
      if (!ok) {
        // Defer retry to end instead of immediate retry
        failedBatches.push({ suffix, chunk });
        await sleep(400);
        continue;
      }
      // For each probe that exists, validate it mentions A-League / soccer before accepting
      for (let idx = 0; idx < chunk.length; idx++) {
        const n = chunk[idx];
        const probe = probeTitles[idx];
        if (present.has(probe.toLowerCase()) || present.has(norm(probe))) {
          // Single validation attempt; if network fails we keep it for now and validate again at end if needed
          const valid = await validateWikiPage(probe);
          await sleep(120);
          if (valid) {
            resolved.set(n.id, probe);
          } else {
            // Invalid page (no A-League/soccer reference) -> treat as unresolved for this suffix round
            // Try next suffix round later
          }
        }
      }
      await sleep(400);
    }
  }

  // Retry failed batches at end (up to 5 attempts per batch)
  if (failedBatches.length > 0) {
    console.log(`retrying ${failedBatches.length} failed query batches (up to 5 attempts each, deferred)...`);
    for (const fb of failedBatches) {
      const probeTitles = fb.chunk.map((n) => n.title ?? `${n.name}${fb.suffix}`);
      let result: { present: Set<string>; ok: boolean } | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const r = await queryBatch(probeTitles);
        if (r.ok) {
          result = r;
          break;
        }
        await sleep(2000 * (attempt + 1));
      }
      if (!result || !result.ok) {
        console.log(`  batch "${fb.suffix}" still failed after 5 attempts, skipping`);
        continue;
      }
      for (let idx = 0; idx < fb.chunk.length; idx++) {
        const n = fb.chunk[idx];
        if (resolved.has(n.id)) continue;
        const probe = probeTitles[idx];
        if (result.present.has(probe.toLowerCase()) || result.present.has(norm(probe))) {
          const valid = await validateWikiPage(probe);
          await sleep(120);
          if (valid) resolved.set(n.id, probe);
        }
      }
      await sleep(400);
    }
  }

  // unresolved -> no article -> obscurity 100
  for (const n of names.filter((x) => !resolved.has(x.id))) {
    resolved.set(n.id, "__none__");
  }
  console.log(`resolved titles: ${[...resolved.values()].filter((t) => t !== "__none__").length}`);

  // ---- fetch views + score ----
  const updates: { id: number; wiki_title: string | null; wiki_views_monthly: number | null; obscurity: number | null }[] = [];
  const failedViews: { id: number; title: string }[] = [];
  let done = 0;
  for (const [id, title] of resolved) {
    let views: number | null;
    if (title === "__none__") {
      views = 0;
    } else {
      views = await yearlyViews(title);
      if (views == null) {
        // queue for deferred retry instead of immediate retry
        failedViews.push({ id, title });
        done++;
        await sleep(120);
        continue;
      }
    }
    const score = obscurityFromViews(title === "__none__" ? 0 : views);
    updates.push({ id, wiki_title: title === "__none__" ? null : title, wiki_views_monthly: views, obscurity: score });
    done++;
    if (done % 200 === 0) {
      console.log(`progress: ${done}/${names.length} scored`);
      await flush(supabase, updates.splice(0));
    }
    await sleep(120);
  }
  await flush(supabase, updates.splice(0));

  // Deferred views retries: up to 5 attempts per player before abandoning
  if (failedViews.length > 0) {
    console.log(`retrying ${failedViews.length} views fetches (up to 5 attempts each, deferred)...`);
    for (const f of failedViews) {
      const views = await fetchViewsWithDeferredRetries(f.title);
      if (views == null) {
        console.log(`  still failed for ${f.title} after 5 attempts, scoring as 100`);
        const score = 100;
        updates.push({ id: f.id, wiki_title: f.title, wiki_views_monthly: 0, obscurity: score });
      } else {
        const score = obscurityFromViews(views);
        console.log(`  retry ok for ${f.title} views 365d=${views} obscurity=${score}`);
        updates.push({ id: f.id, wiki_title: f.title, wiki_views_monthly: views, obscurity: score });
      }
      await sleep(300);
    }
    await flush(supabase, updates.splice(0));
  }

  function flush(
    supa: ReturnType<typeof createAdminClient>,
    batch: typeof updates,
  ) {
    return Promise.all(
      batch.map(async (u) => {
        const update: Record<string, unknown> = {
          wiki_title: u.wiki_title,
          wiki_views_monthly: u.wiki_views_monthly,
          obscurity: u.obscurity,
        };
        if (u.wiki_title) update.wiki_title = u.wiki_title;
        const { error } = await supa.from("players").update(update).eq("id", u.id);
        if (error) throw new Error(`update player ${u.id}: ${error.message}`);
      }),
    );
  }

  const scored = updates.filter((u) => u.obscurity != null);
  const dist = new Map<string, number>();
  for (const u of scored) {
    const k =
      u.obscurity! >= 80
        ? "80+"
        : u.obscurity! >= 60
          ? "60-79"
          : u.obscurity! >= 40
            ? "40-59"
            : u.obscurity! >= 20
              ? "20-39"
              : "0-19";
    dist.set(k, (dist.get(k) ?? 0) + 1);
  }
  const unresolvedCount = [...resolved.values()].filter((t) => t === "__none__").length;
  console.log(`done: ${done} processed, ${scored.length} scored this run, ${unresolvedCount} without a wiki article`);
  console.log("obscurity distribution:", [...dist.entries()].sort());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
