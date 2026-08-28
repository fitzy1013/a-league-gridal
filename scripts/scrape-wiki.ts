/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAdminClient } from "../lib/db/supabase-admin";
import { CLUBS } from "../lib/scrape/ual";

process.loadEnvFile(".env");

/**
 * Resolves every player's English Wikipedia article, fetches the last
 * month's pageviews (single monthly request per player), and stores a
 * 0-100 obscurity rating on players.
 *
 * Resolution order: manual overrides -> exact title -> "(footballer)" /
 * "(soccer)" variants -> accent-insensitive match. Each resolved title is
 * validated to ensure the page mentions an A-League club, the A-League
 * competition, or at least is a soccer player page. Unresolved or
 * invalid players score as fully obscure (100).
 *
 * Retries: single attempt per player up front; failures queued and retried
 * at the end up to 5 times per player before abandoning.
 * Obscurity: <=30 views = 100, then 100 - 25*log10(views/30) (30->100,
 * 300->75, 3k->50, 30k->25, 300k->0).
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

/** Total views last complete month via monthly endpoint — single attempt, deferred retries handled by caller */
async function yearlyViews(title: string): Promise<number | null> {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
  const fmt = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}01`;
  const url =
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/` +
    `${encodeURIComponent(title)}/monthly/${fmt(start)}/${fmt(end)}`;
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
  // 30->100, 300->75, 3k->50, 30k->25, 300k->0 (views = last month)
  return Math.round(Math.max(0, Math.min(100, 100 - 25 * Math.log10(views / 30))));
}

async function fetchViewsWithDeferredRetries(title: string): Promise<number | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const v = await yearlyViews(title);
    if (v != null) return v;
    const backoff = 3000 * (attempt + 1) + Math.floor(Math.random() * 500);
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

  // Retry failed batches at end (up to 5 attempts per batch) — throttled
  if (failedBatches.length > 0) {
    console.log(`retrying ${failedBatches.length} failed query batches (up to 5 attempts each, deferred)...`);
    for (let idx = 0; idx < failedBatches.length; idx++) {
      const fb = failedBatches[idx];
      const probeTitles = fb.chunk.map((n) => n.title ?? `${n.name}${fb.suffix}`);
      let result: { present: Set<string>; ok: boolean } | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const r = await queryBatch(probeTitles);
        if (r.ok) {
          result = r;
          break;
        }
        await sleep(3000 * (attempt + 1));
      }
      if (!result || !result.ok) {
        console.log(`  batch "${fb.suffix}" still failed after 5 attempts, skipping`);
        continue;
      }
      for (let j = 0; j < fb.chunk.length; j++) {
        const n = fb.chunk[j];
        if (resolved.has(n.id)) continue;
        const probe = probeTitles[j];
        if (result.present.has(probe.toLowerCase()) || result.present.has(norm(probe))) {
          const valid = await validateWikiPage(probe);
          await sleep(300);
          if (valid) resolved.set(n.id, probe);
        }
      }
      await sleep(1500);
      if ((idx + 1) % 10 === 0) await sleep(3000);
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
    if (title !== "__none__") {
      const nm = names.find((n) => n.id === id)?.name ?? String(id);
      console.log(`  FOUND ${nm} (${id}) -> "${title}" views=${views} obscurity=${score}`);
    }
    done++;
    if (done % 200 === 0) {
      console.log(`progress: ${done}/${names.length} scored`);
      await flush(supabase, updates.splice(0));
    }
    await sleep(120);
  }
  await flush(supabase, updates.splice(0));

  // Deferred views retries: up to 5 attempts per player before abandoning — throttled to avoid burst 10→429
  if (failedViews.length > 0) {
    console.log(`retrying ${failedViews.length} views fetches (up to 5 attempts each, deferred)...`);
    for (let i = 0; i < failedViews.length; i++) {
      const f = failedViews[i];
      const views = await fetchViewsWithDeferredRetries(f.title);
      if (views == null) {
        console.log(`  still failed for ${f.title} after 5 attempts, scoring as 100`);
        const score = 100;
        updates.push({ id: f.id, wiki_title: f.title, wiki_views_monthly: 0, obscurity: score });
      } else {
        const score = obscurityFromViews(views);
        console.log(`  retry ok for ${f.title} views=${views} obscurity=${score} [${i + 1}/${failedViews.length}]`);
        updates.push({ id: f.id, wiki_title: f.title, wiki_views_monthly: views, obscurity: score });
      }
      // Throttle: 1.5s between deferred retries + extra pause every 10 to respect bucket
      await sleep(1500);
      if ((i + 1) % 10 === 0) {
        console.log(`  throttling pause after 10 deferred retries...`);
        await sleep(3000);
      }
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
  console.log("\n=== ALL PLAYERS FOUND ===");
  for (const u of [...updates].sort((a, b) => (a.obscurity ?? 0) - (b.obscurity ?? 0))) {
    if (u.wiki_title) {
      const nm = names.find((n) => n.id === u.id)?.name ?? String(u.id);
      console.log(`${nm} | wiki:"${u.wiki_title}" | views=${u.wiki_views_monthly} | obscurity=${u.obscurity}`);
    }
  }
  console.log("=== END ALL PLAYERS FOUND ===\n");
  console.log("obscurity distribution:", [...dist.entries()].sort());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
