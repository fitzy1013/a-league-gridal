"use server";

import { upsertUserResult } from "@/lib/db/queries";
import { createClient } from "@/lib/supabase/server";

export async function recordResult(gridId: string, correct: number, total: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, reason: "not-signed-in" };
  }

  try {
    await upsertUserResult(supabase, {
      user_id: user.id,
      grid_id: gridId,
      correct,
      total,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "error" };
  }
}