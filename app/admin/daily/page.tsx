"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Category, CellSolution, GridSpec } from "@/lib/grid/types";
import { CATEGORY_LABELS } from "@/lib/grid/labels";

interface PreviewCell {
  r: number;
  c: number;
  count: number;
  sample: string[];
}

interface PreviewResponse {
  ok?: boolean;
  grid?: GridSpec;
  cells?: PreviewCell[];
  error?: string;
}

const SECRET_KEY = "admin_secret";

function countColor(count: number): string {
  if (count === 0) return "bg-destructive text-destructive-foreground";
  if (count > 50) return "bg-red-500/80 text-white";
  if (count < 3) return "bg-orange-400/80 text-black";
  return "bg-emerald-500/80 text-white";
}

export default function AdminDailyPage() {
  const [secret, setSecret] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [grid, setGrid] = useState<GridSpec | null>(null);
  const [cells, setCells] = useState<PreviewCell[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(SECRET_KEY);
    if (stored) setSecret(stored);
  }, []);

  const headers = useCallback(
    () => ({ "content-type": "application/json", authorization: `Bearer ${secret}` }),
    [secret],
  );

  const generate = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/daily-preview", { method: "POST", headers: headers() });
      const data = (await res.json()) as PreviewResponse;
      if (!res.ok || !data.grid) {
        setMessage(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setGrid(data.grid);
      setCells(data.cells ?? []);
    } catch {
      setMessage("Request failed");
    } finally {
      setBusy(false);
    }
  }, [headers]);

  const approve = useCallback(async () => {
    if (!grid) return;
    if (!confirm("Publish this as today's grid? It replaces whatever is live.")) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/daily-commit", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(grid),
      });
      const data = (await res.json()) as { ok?: boolean; date?: string; error?: string };
      setMessage(
        res.ok && data.ok ? `Published for ${data.date}` : (data.error ?? `Failed (${res.status})`),
      );
    } catch {
      setMessage("Request failed");
    } finally {
      setBusy(false);
    }
  }, [grid, headers]);

  if (!secret) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-4 p-6">
        <h1 className="text-xl font-bold">Daily Grid Admin</h1>
        <p className="text-sm text-muted-foreground">
          Enter the CRON_SECRET to manage daily grids.
        </p>
        <input
          type="password"
          value={secretInput}
          onChange={(e) => setSecretInput(e.target.value)}
          placeholder="CRON_SECRET"
          className="rounded-md border bg-background px-3 py-2 text-sm"
        />
        <Button
          onClick={() => {
            localStorage.setItem(SECRET_KEY, secretInput);
            setSecret(secretInput);
          }}
          disabled={!secretInput}
          type="button"
        >
          Unlock
        </Button>
      </div>
    );
  }

  const cellInfo = (r: number, c: number) => cells.find((x) => x.r === r && x.c === c);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Daily Grid Admin</h1>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => {
            localStorage.removeItem(SECRET_KEY);
            setSecret("");
            setGrid(null);
          }}
        >
          Lock
        </Button>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => void generate()} disabled={busy} type="button">
          {grid ? "Reject & New Candidate" : "Generate Candidate"}
        </Button>
        {grid && (
          <Button onClick={() => void approve()} disabled={busy} variant="outline" type="button">
            Approve & Publish
          </Button>
        )}
      </div>

      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      {grid && (
        <>
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `auto repeat(3, minmax(0, 1fr))` }}
          >
            <div />
            {grid.colValues.map((v, c) => (
              <div key={`c-${c}`} className="rounded-md bg-accent px-2 py-2 text-center text-xs">
                <div className="font-semibold leading-tight">{v}</div>
                <div className="mt-0.5 text-[10px] uppercase text-muted-foreground">
                  {CATEGORY_LABELS[grid.colTypes[c] as Category]}
                </div>
              </div>
            ))}
            {grid.rowValues.map((rv, r) => (
              <FragmentRow key={`r-${r}`}>
                <div className="rounded-md bg-accent px-2 py-2 text-center text-xs">
                  <div className="font-semibold leading-tight">{rv}</div>
                  <div className="mt-0.5 text-[10px] uppercase text-muted-foreground">
                    {CATEGORY_LABELS[grid.rowTypes[r] as Category]}
                  </div>
                </div>
                {[0, 1, 2].map((c) => {
                  const info = cellInfo(r, c);
                  return (
                    <div
                      key={`cell-${r}-${c}`}
                      className={`${countColor(info?.count ?? 0)} rounded-md px-2 py-3 text-center`}
                      title={info?.sample.join(", ")}
                    >
                      <div className="text-lg font-bold">{info?.count ?? "?"}</div>
                      <div className="text-[10px] opacity-90">answers</div>
                    </div>
                  );
                })}
              </FragmentRow>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Hover a cell for sample answers. Red &gt;50 answers (max 2 allowed), orange &lt;3.
          </p>

          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Solution answer key
            </summary>
            <ul className="mt-2 space-y-1 text-xs">
              {grid.solution.map((s: CellSolution) => (
                <li key={`${s.rowIdx}-${s.colIdx}`}>
                  ({s.rowIdx},{s.colIdx}): {s.playerName ?? s.playerId}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <div className="contents">{children}</div>;
}
