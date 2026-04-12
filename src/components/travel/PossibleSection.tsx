"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";

interface PossibleResult {
  kennelId: string;
  kennelSlug: string;
  kennelName: string;
  date: string | null;
  distanceKm: number;
  explanation: string;
  sourceLinks: { url: string; label: string; type: string }[];
}

interface PossibleSectionProps {
  results: PossibleResult[];
}

export function PossibleSection({ results }: PossibleSectionProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (results.length === 0) return null;

  return (
    <div className="mt-8 border-l-2 border-dashed border-border pl-5">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
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

      {isOpen && (
        <div id="possible-list" className="space-y-0 pb-4">
          {results.map((result) => (
            <div
              key={result.kennelId}
              className="border-b border-border py-3 last:border-b-0"
            >
              <div className="text-sm font-medium text-muted-foreground">
                {result.kennelName}
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground/70">
                <span>{result.explanation.split("—")[0]?.trim() || "Timing varies"}</span>
                <span>·</span>
                <span>{result.distanceKm.toFixed(1)} km</span>
              </div>
              {result.sourceLinks.length > 0 && (
                <div className="mt-1.5 text-xs italic text-muted-foreground/60">
                  — check their{" "}
                  <a
                    href={result.sourceLinks[0].url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {result.sourceLinks[0].label}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                  {" "}closer to your trip.
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
