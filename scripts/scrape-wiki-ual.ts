/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAdminClient } from "../lib/db/supabase-admin";
import { UAL_BASE, fetchHtml } from "../lib/scrape/ual";

process.loadEnvFile(".env");

/**
 * New obscurity scraper using the UAL "More information at Wikipedia" link
 * on each player's profile page.
 *
 * - If no link exists -> wiki_title null, views 0, obscurity 100
 * - If link exists -> fetch last 365 days of pageviews, sum, then score
 *   0-100 where <100 views = 100, then log scale: 100 - 25*log10(views/100)
 *   (100->100, 1k->75, 10k->50, 100k->25, 1M->0). Total 900 for 9 cells.
 *
 * Usage: npx tsx scripts/scrape-wiki-ual.ts
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = { "user-agent": "a-league-grid-obscurity-ual/1.0" };

function extractWikiTitle(html: string): string | null {
  // Matches: <a href="https://en.wikipedia.org/wiki/Brian_Kaltak" ...>More information at Wikipedia
  const m = html.match(/href="https?:\/\/en\.wikipedia\.org\/wiki\/([^"]+)"[^>]*>\s*More information at Wikipedia/i);
  if (!m) return null;
  try {
    const raw = decodeURIComponent(m[1]);
    // Wikipedia URLs use underscores for spaces; API likes spaces or underscores, store with spaces.
    return raw.replace(/_/g, " ");
  } catch {
    return m[1].replace(/_/g, " ");
  }
}

/** Total views in last 365 days (daily granularity). */
async function yearlyViews(title: string): Promise<number | null> {
  const end = new Date();
  end.setDate(end.getDate() - 1); // yesterday = last complete day
  const start = new Date(end);
  start.setDate(start.getDate() - 364);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const url =
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/` +
    `${encodeURIComponent(title.replace(/ /g, "_"))}/daily/${fmt(start)}/${fmt(end)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.status === 404) return 0;
      if (res.status === 429 || res.status >= 500) throw new Error(String(res.status));
      const json: any = await res.json();
      const items: number[] = (json?.items ?? []).map((i: any) => i.views ?? 0);
      // Sum of 365 days
      return items.reduce((a, b) => a + b, 0);
    } catch {
      await sleep(1500 * (attempt + 1));
    }
  }
  return null;
}

function obscurityFromYearlyViews(views: number | null): number | null {
  if (views == null) return null;
  if (views < 100) return 100;
  // 100->100, 1k->75, 10k->50, 100k->25, 1M->0
  const score = 100 - 25 * Math.log10(views / 100);
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

  // Optionally only re-scrape those without obscurity or with mismatched wiki_title?
  // For this migration, we re-evaluate all via UAL link.
  let done = 0;
  let withLink = 0;
  let withoutLink = 0;
  const updates: { id: number; wiki_title: string | null; wiki_views_monthly: number | null; obscurity: number | null }[] = [];

  for (const p of players) {
    let title: string | null = null;
    try {
      const html = await fetchHtml(`${UAL_BASE}/player/?player_id=${p.id}`);
      title = extractWikiTitle(html);
    } catch (e) {
      console.log(`  fetch failed for ${p.name} (${p.id}): ${e instanceof Error ? e.message : String(e)}`);
      // Leave for next run? For now treat as no link -> 100
      title = null;
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
      views = await yearlyViews(title);
      if (views == null) {
        console.log(`  views fetch failed for ${p.name} -> "${title}", will retry next run`);
        done++;
        await sleep(300);
        continue;
      }
      score = obscurityFromYearlyViews(views);
      updates.push({ id: p.id, wiki_title: title, wiki_views_monthly: views, obscurity: score });
      // Log a few examples
      if (withLink <= 5) console.log(`  ${p.name} -> "${title}" views 365d=${views} obscurity=${score}`);
    }

    done++;
    if (done % 100 === 0) {
      console.log(`progress: ${done}/${players.length} (${withLink} with link, ${withoutLink} without)`);
      await flush(supabase, updates.splice(0));
    }
    await sleep(350); // be nice to UAL + Wikimedia (2 req per player with link)
  }
  await flush(supabase, updates.splice(0));

  function flush(supa: ReturnType<typeof createAdminClient>, batch: typeof updates) {
    if (batch.length === 0) return Promise.resolve();
    return Promise.all(
      batch.map(async (u) => {
        const { error } = await supa.from("players").update({ wiki_title: u.wiki_title, wiki_views_monthly: u.wiki_views_monthly, obscurity: u.obscurity }).eq("id", u.id);
        if (error) throw new Error(`update ${u.id}: ${error.message}`);
      }),
    );
  }

  console.log(`done: ${done} players, ${withLink} with Wikipedia link, ${withoutLink} without (100)`);
  const dist = new Map<string, number>();
  for (const u of updates) {
    const k = u.obscurity! >= 80 ? "80+" : u.obscurity! >= 60 ? "60-79" : u.obscurity! >= 40 ? "40-59" : u.obscurity! >= 20 ? "20-39" : "0-19";
    dist.set(k, (dist.get(k) ?? 0) + 1);
  }
  console.log("obscurity distribution (this run):", [...dist.entries()].sort());
}

main().catch((e) => { console.error(e); process.exit(1); });
