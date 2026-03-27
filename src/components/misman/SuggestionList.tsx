"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { InfoPopover } from "@/components/ui/info-popover";

const MAX_VISIBLE = 10;

/** A scored hasher suggestion for the attendance tap-to-add list. */
export interface SuggestionItem {
  kennelHasherId: string;
  hashName: string | null;
  nerdName: string | null;
  /** Suggestion score (0–1) from the scoring algorithm. */
  score: number;
}

/** Props for the SuggestionList — tap-to-add suggestion chips on the attendance form. */
interface SuggestionListProps {
  suggestions: SuggestionItem[];
  /** IDs of hashers already marked as attended (filtered out of visible suggestions). */
  attendedHasherIds: Set<string>;
  /** Callback when a suggestion chip is tapped. */
  onSelect: (hasherId: string) => void;
  disabled?: boolean;
}

/** Filter out attended hashers and cap visible suggestions at `maxVisible` (default 10). */
export function getVisibleSuggestions(
  suggestions: SuggestionItem[],
  attendedHasherIds: Set<string>,
  maxVisible = MAX_VISIBLE,
): { visible: SuggestionItem[]; hiddenCount: number } {
  const available = suggestions.filter(
    (s) => !attendedHasherIds.has(s.kennelHasherId),
  );
  const visible = available.slice(0, maxVisible);
  return { visible, hiddenCount: available.length - visible.length };
}

export function SuggestionList({
  suggestions,
  attendedHasherIds,
  onSelect,
  disabled,
}: SuggestionListProps) {
  const [expanded, setExpanded] = useState(false);

  const allAvailable = useMemo(
    () => getVisibleSuggestions(suggestions, attendedHasherIds, Infinity).visible,
    [suggestions, attendedHasherIds],
  );

  if (allAvailable.length === 0) return null;

  const hiddenCount = Math.max(0, allAvailable.length - MAX_VISIBLE);
  const visible = expanded ? allAvailable : allAvailable.slice(0, MAX_VISIBLE);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <p className="text-xs font-medium text-muted-foreground">
          Suggestions
        </p>
        {hiddenCount > 0 && (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
          >
            {expanded ? (
              <>
                Show less
                <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                (+{hiddenCount} more)
                <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        )}
        <InfoPopover title="Suggestions">
          Suggestions are based on who shows up most often and most recently.
          They update as you add hashers &mdash; tap a name to mark them as
          attended.
        </InfoPopover>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((s) => (
          <button
            key={s.kennelHasherId}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            onClick={() => onSelect(s.kennelHasherId)}
            disabled={disabled}
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            {s.hashName || s.nerdName}
          </button>
        ))}
      </div>
    </div>
  );
}
