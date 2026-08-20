import * as fs from "node:fs";
import * as path from "node:path";
import { createAdminClient } from "../lib/db/supabase-admin";
import { loadPlayers } from "../lib/db/queries";

try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional on CI/Vercel (env vars come from the platform).
}

/**
 * Builds public/players.json (all players, sorted by name) so the guess
 * autocomplete can filter client-side instead of calling /api/players per
 * keystroke. Runs automatically before `npm run build`; skips silently when
 * Supabase env vars are unavailable so builds don't fail.
 */
async function main() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("[players.json] SUPABASE_SERVICE_ROLE_KEY not set — skipping generation");
    return;
  }
  const supabase = createAdminClient();
  const players = await loadPlayers(supabase);
  const data = players
    .map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      club_id: p.club_id,
      nationality: p.nationality,
      nationality_flag_url: p.nationality_flag_url,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const publicDir = path.join(process.cwd(), "public");
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, "players.json"), JSON.stringify(data));
  console.log(`[players.json] wrote ${data.length} players`);
}

main().catch((e) => {
  console.error("[players.json] generation failed:", e);
  process.exit(1);
});