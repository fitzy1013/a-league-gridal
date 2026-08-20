import { updateSession } from "@/lib/supabase/proxy";
import { type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Only protected/account routes need the session check. Everything else
     * (game pages, /answers, /api) bypasses the proxy entirely, avoiding an
     * edge + Supabase round-trip on every request.
     */
    "/protected/:path*",
    "/auth/:path*",
  ],
};
