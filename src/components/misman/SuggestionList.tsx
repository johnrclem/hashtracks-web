"use client";

import { Button } from "@/components/ui/button";
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
  const { visible, hiddenCount } = getVisibleSuggestions(
    suggestions,
    attendedHasherIds,
  );

  if (visible.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <p className="text-xs font-medium text-muted-foreground">
          Suggestions
          {hiddenCount > 0 && (
            <span className="ml-1 font-normal">(+{hiddenCount} more)</span>
          )}
        </p>
        <InfoPopover title="Suggestions">
          Suggestions are based on who shows up most often and most recently.
          They update as you add hashers &mdash; tap a name to mark them as
          attended.
        </InfoPopover>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((s) => (
          <Button
            key={s.kennelHasherId}
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onSelect(s.kennelHasherId)}
            disabled={disabled}
          >
            {s.hashName || s.nerdName}
          </Button>
        ))}
      </div>
    </div>
  );
}
