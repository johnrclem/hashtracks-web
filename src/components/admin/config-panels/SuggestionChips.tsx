"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { suggestKennelPatterns } from "@/lib/source-detect";

interface SuggestionChipsProps {
  /** Unmatched kennel tags from preview or open alerts */
  unmatchedTags: string[];
  /** Patterns already in the editor — used to filter already-covered tags */
  existingPatterns: [string, string][];
  /** Called when admin accepts a suggestion */
  onAccept: (pattern: [string, string]) => void;
}

export function SuggestionChips({
  unmatchedTags,
  existingPatterns,
  onAccept,
}: SuggestionChipsProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const suggestions = suggestKennelPatterns(
    unmatchedTags.filter((tag) => !existingPatterns.some(([, t]) => t === tag)),
  );

  const pending = suggestions.filter(([, tag]) => !dismissed.has(tag));

  if (pending.length === 0) return null;

  return (
    <div className="space-y-1 pt-1">
      <p className="text-xs font-medium text-amber-700">Suggested patterns for unmatched tags:</p>
      <div className="flex flex-wrap gap-1">
        {pending.map(([pattern, tag]) => (
          <div
            key={tag}
            className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800"
          >
            <span className="font-mono">{pattern}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-4 w-4 p-0 text-green-700 hover:text-green-900"
              title="Accept"
              onClick={() => {
                onAccept([pattern, tag]);
                setDismissed((prev) => new Set([...prev, tag]));
              }}
            >
              ✓
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive"
              title="Dismiss"
              onClick={() => setDismissed((prev) => new Set([...prev, tag]))}
            >
              &times;
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
