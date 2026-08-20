"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { PlayerOption } from "./types";

// The static player list (public/players.json) is fetched once per session so
// search never hits /api/players; if it's unavailable we fall back to the API.
let poolPromise: Promise<PlayerOption[] | null> | null = null;

function loadPlayerPool(): Promise<PlayerOption[] | null> {
  if (!poolPromise) {
    poolPromise = fetch("/players.json")
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as PlayerOption[];
        return Array.isArray(data) ? data : null;
      })
      .catch(() => null);
  }
  return poolPromise;
}

function filterPool(pool: PlayerOption[], query: string): PlayerOption[] {
  const q = query.trim().toLowerCase();
  const direct: PlayerOption[] = [];
  const indirect: PlayerOption[] = [];
  for (const p of pool) {
    const name = p.name.toLowerCase();
    if (!name.includes(q)) continue;
    if (name.startsWith(q)) direct.push(p);
    else indirect.push(p);
  }
  return [...direct, ...indirect].slice(0, 12);
}

export default function GuessInput({
  onSelect,
  onClose,
}: {
  onSelect: (player: PlayerOption) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      const pool = await loadPlayerPool();
      if (cancelled) return;
      if (pool) {
        setResults(filterPool(pool, trimmed));
        setActiveIndex(0);
        setLoading(false);
        return;
      }
      // Fallback: search the server (used only when players.json is missing).
      try {
        const res = await fetch(`/api/players?q=${encodeURIComponent(trimmed)}`);
        const data = (await res.json()) as PlayerOption[];
        if (!cancelled) {
          setResults(data);
          setActiveIndex(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [query]);

  const pick = (player: PlayerOption) => {
    onSelect(player);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const player = results[activeIndex];
      if (player) pick(player);
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search a player…"
          className="pl-8"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {results.map((player, i) => (
            <li key={player.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(player)}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                  i === activeIndex && "bg-accent",
                )}
              >
                <span className="font-medium">{player.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {player.position ?? ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && query.trim().length >= 1 && results.length === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          No players found for &ldquo;{query.trim()}&rdquo;
        </p>
      )}
    </div>
  );
}