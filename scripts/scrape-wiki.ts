/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAdminClient } from "../lib/db/supabase-admin";

process.loadEnvFile(".env");

/**
 * Resolves every player's English Wikipedia article, fetches the last 3
 * months of pageviews, and stores a 0-100 obscurity rating on players.
 *
 * Resolution order: manual overrides -> exact title -> "(footballer)" /
 * "(soccer)" variants -> accent-insensitive match. Unresolved players score
 * as fully obscure (100).
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

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = { "user-agent": "a-league-grid-obscurity/1.0 (contact via github)" };

async function queryBatch(chunk: string[]): Promise<{ present: Set<string>; ok: boolean }> {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&titles=" +
    encodeURIComponent(chunk.join("|"));
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.status === 429 || res.status >= 500) throw new Error(String(res.status));
      const json: any = await res.json();
      const present = new Set<string>();
      for (const p of Object.values(json?.query?.pages ?? {}) as any[]) {
        if (!p.missing) {
          present.add(String(p.title).toLowerCase());
          // accent-insensitive aliases so "Milos" matches "Miloš"
          present.add(norm(String(p.title)));
        }
      }
      return { present, ok: true };
    } catch {
      await sleep(2000 * (attempt + 1));
    }
  }
  return { present: new Set(), ok: false };
}

/** Median monthly views over the last 3 full months. */
async function monthlyViews(title: string): Promise<number | null> {
  const end = new Date();
  end.setMonth(end.getMonth() - 1, 1); // last complete month
  const start = new Date(end);
  start.setMonth(start.getMonth() - 2);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const url =
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/` +
    `${encodeURIComponent(title)}/monthly/${fmt(start)}/${fmt(end)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.status === 404) return 0;
      if (res.status === 429 || res.status >= 500) throw new Error(String(res.status));
      const json: any = await res.json();
      const items: number[] = (json?.items ?? []).map((i: any) => i.views ?? 0);
      if (items.length === 0) return 0;
      const sorted = [...items].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    } catch {
      await sleep(1500 * (attempt + 1));
    }
  }
  return null;
}

function obscurityFromViews(views: number | null): number | null {
  if (views == null) return null;
  if (views <= 0) return 100;
  // log-scale inverse: 10k+ monthly views -> 0, single digits -> high 90s
  return Math.round(Math.max(0, Math.min(100, 100 - 25 * Math.log10(views))));
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

  // exact + variant rounds
  for (const suffix of ["", " (footballer)", " (soccer)"]) {
    const remaining = names.filter((n) => !resolved.has(n.id));
    if (remaining.length === 0) break;
    console.log(`resolving round "${suffix || "exact"}": ${remaining.length}`);
    for (let i = 0; i < remaining.length; i += 25) {
      const chunk = remaining.slice(i, i + 25);
      const probeTitles = chunk.map((n) => n.title ?? `${n.name}${suffix}`);
      const { present, ok } = await queryBatch(probeTitles);
      chunk.forEach((n, idx) => {
        const probe = probeTitles[idx];
        if (ok && (present.has(probe.toLowerCase()) || present.has(norm(probe)))) {
          resolved.set(n.id, probe);
        }
      });
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
  let done = 0;
  for (const [id, title] of resolved) {
    let views: number | null;
    if (title === "__none__") {
      views = 0;
    } else {
      views = await monthlyViews(title);
      if (views == null) {
        // couldn't fetch views — leave for next run
        done++;
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