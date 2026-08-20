import { isAuthorizedCron } from "@/lib/cron-auth";
import { runScrape } from "@/lib/scrape/run-scrape";

// Long enough for ~24 sequential page fetches. Hobby caps this at 60s.
export const maxDuration = 60;

/**
 * Scrapes Ultimate A-League and upserts the DB. Triggered by the Vercel cron
 * in vercel.json (03:00 UTC every 2 days).
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runScrape();
  return Response.json(result);
}