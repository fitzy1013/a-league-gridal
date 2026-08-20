"use client";

import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import type { CellState } from "./types";

const statusClasses: Record<CellState["status"], string> = {
  empty: "bg-muted hover:bg-accent",
  correct: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  incorrect: "bg-red-500/15 text-red-700 dark:text-red-300",
  revealed: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
};

export default function Cell({
  cell,
  selected,
  disabled,
  onClick,
}: {
  cell: CellState;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const canEdit = !disabled && (cell.status === "empty" || cell.status === "incorrect");

  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={onClick}
      className={cn(
        "flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-md border px-1 py-2 text-center text-sm transition-colors",
        statusClasses[cell.status],
        selected && "ring-2 ring-ring",
        canEdit && "cursor-pointer",
      )}
    >
      {cell.playerName ? (
        <span className="line-clamp-2 font-medium leading-tight">{cell.playerName}</span>
      ) : (
        <Plus className="h-4 w-4 opacity-40" />
      )}
      {cell.status === "incorrect" && (
        <span className="text-[10px] uppercase tracking-wide opacity-70">Incorrect</span>
      )}
    </button>
  );
}