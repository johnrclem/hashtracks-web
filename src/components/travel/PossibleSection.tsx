"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { capture } from "@/lib/analytics";
import { PossibleRow, type PossibleRowData } from "./PossibleRow";

interface PossibleResult extends PossibleRowData {
  date: string | null;
}

interface PossibleSectionProps {
  results: PossibleResult[];
  /** Post-filter confirmed count; section auto-expands when zero. */
  confirmedCount: number;
}

export function PossibleSection({ results, confirmedCount }: PossibleSectionProps) {
  const [isOpen, setIsOpen] = useState(confirmedCount === 0);

  if (results.length === 0) return null;

  return (
    <div className="mt-8 border-l-2 border-dashed border-border pl-5">
      <button
        type="button"
        onClick={() => {
          setIsOpen((prev) => {
            if (!prev) capture("travel_possible_section_expanded", {});
            return !prev;
          });
        }}
        className="
          flex w-full items-center justify-between py-3
          text-muted-foreground transition-colors hover:text-foreground
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-md
        "
        aria-expanded={isOpen}
        aria-controls="possible-list"
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
          Possible activity · {results.length} more kennel{results.length !== 1 ? "s" : ""}
        </div>
        <span className="font-mono text-[11px] uppercase tracking-wider">
          Lower confidence
        </span>
      </button>

      <div id="possible-list" className={`space-y-0 pb-4 ${isOpen ? "" : "hidden"}`}>
        {results.map((result, i) => (
          <PossibleRow
            key={`${result.kennelId}-${result.date ?? "cadence"}-${i}`}
            result={result}
          />
        ))}
      </div>
    </div>
  );
}
