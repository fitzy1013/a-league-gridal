import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isTodaysGridV2 } from "@/lib/db/queries";

/**
 * Rendered inside a Suspense boundary: streams after the live grid ruleset
 * check, keeping the play pages prerenderable.
 */
export async function RulesNav() {
  const supabase = await createClient();
  const live = await isTodaysGridV2(supabase);
  if (!live) return null;
  return (
    <Link href="/play/rules" className="ml-auto text-muted-foreground">
      Rules
    </Link>
  );
}
