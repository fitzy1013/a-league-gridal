"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CellState } from "./types";

function emojiFor(status: CellState["status"]): string {
  switch (status) {
    case "correct":
      return "🟩";
    case "incorrect":
      return "🟥";
    case "revealed":
      return "🟨";
    default:
      return "⬜";
  }
}

export default function ShareButton({
  rows,
  mode,
  date,
  correct,
  total,
}: {
  rows: CellState[][];
  mode: "daily" | "unlimited";
  date: string | null;
  correct: number;
  total: number;
}) {
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => {
    const title =
      mode === "daily"
        ? `A-League Grid — Daily ${date ?? ""}`
        : "A-League Grid — Unlimited";
    const grid = rows.map((row) => row.map((cell) => emojiFor(cell.status)).join("")).join("\n");
    return `${title}\n${grid}\n\nScore: ${correct}/${total}`;
  }, [rows, mode, date, correct, total]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={copy} type="button">
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied!" : "Share"}
    </Button>
  );
}