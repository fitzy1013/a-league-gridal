"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import GameGrid from "@/app/components/grid/GameGrid";
import type { ClientGridSpec } from "@/app/components/grid/types";

export default function UnlimitedPage() {
  const [spec, setSpec] = useState<ClientGridSpec | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSpec(null);
    setError(null);
    try {
      const res = await fetch("/api/random-grid", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      setSpec({
        gridId: null,
        mode: "unlimited",
        date: null,
        rowTypes: data.rowTypes,
        colTypes: data.colTypes,
        rowValues: data.rowValues,
        colValues: data.colValues,
        solution: data.solution,
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Failed to generate a grid. Try again.",
      );
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-xl">
        {error ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <p className="text-destructive">{error}</p>
            <p className="max-w-md text-sm text-muted-foreground">
              The unlimited grid is served by the API route
              <code className="mx-1 rounded bg-accent px-1">/api/random-grid</code>. It works with{" "}
              <code className="mx-1 rounded bg-accent px-1">next dev</code> and on Vercel. If it
              keeps failing, make sure the Supabase tables are populated (run the scraper once) and
              that <code className="mx-1 rounded bg-accent px-1">SUPABASE_SERVICE_ROLE_KEY</code> is
              set.
            </p>
            <Button onClick={load} type="button">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : spec ? (
          <div>
            <GameGrid spec={spec} />
            <div className="mt-6 flex justify-center">
              <Button variant="outline" onClick={load} type="button">
                <RefreshCw className="mr-2 h-4 w-4" />
                New grid
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Generating a grid…</p>
          </div>
        )}
      </div>
    </div>
  );
}
