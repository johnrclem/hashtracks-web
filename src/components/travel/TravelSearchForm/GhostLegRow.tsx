"use client";

import { Plus } from "lucide-react";
import { BoardingStamp } from "./BoardingStamp";

/**
 * Faded dashed-border row below the last committed leg. Tapping
 * unfolds a fresh leg. Mirrors the boarding-pass "pending segment"
 * metaphor — visible promise of future content without cluttering
 * the primary ticket.
 */
export function GhostLegRow({
  nextIndex,
  onClick,
}: Readonly<{
  nextIndex: number;
  onClick: () => Promise<void>;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        group flex w-full items-center gap-4 rounded-xl border-[1.5px]
        border-dashed border-muted-foreground/40 bg-card/40 p-5 text-left
        transition-all duration-200
        hover:border-muted-foreground/70 hover:bg-card
      "
    >
      <BoardingStamp label={`LEG ${String(nextIndex).padStart(2, "0")}`} variant="ghost" />
      <span className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.18em] text-muted-foreground/70 group-hover:text-foreground">
        <Plus className="h-3.5 w-3.5" />
        Add next stop
      </span>
      <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/50">
        Where next?
      </span>
    </button>
  );
}
