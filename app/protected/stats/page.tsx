import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserResults } from "@/lib/db/queries";

export const instant = false;

export default async function StatsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login");
  }

  const results = await getUserResults(supabase, user.id);

  return (
    <div className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Your history</h1>
        <p className="text-sm text-muted-foreground">
          Daily grid results for {user.email}
        </p>
      </div>

      {results.length === 0 ? (
        <p className="text-muted-foreground">
          No results yet. Finish today&apos;s daily grid and it will show up here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-accent text-left">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Score</th>
                <th className="px-4 py-2 font-medium">Finished</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={`${r.grid_id}`} className="border-b last:border-0">
                  <td className="px-4 py-2">{r.grids?.[0]?.date ?? "—"}</td>
                  <td className="px-4 py-2">
                    {r.correct}/{r.total}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(r.finished_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}