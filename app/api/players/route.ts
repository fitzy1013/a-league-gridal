import { NextRequest, NextResponse } from "next/server";
import { searchPlayers } from "@/lib/db/queries";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json([]);
  }

  const supabase = await createClient();
  const players = await searchPlayers(supabase, q, 12);

  return NextResponse.json(
    players.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      club_id: p.club_id,
      nationality: p.nationality,
      nationality_flag_url: p.nationality_flag_url,
    })),
  );
}