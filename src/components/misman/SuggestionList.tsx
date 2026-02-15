"use client";

import { Button } from "@/components/ui/button";

const MAX_VISIBLE = 10;

export interface SuggestionItem {
  kennelHasherId: string;
  hashName: string | null;
  nerdName: string | null;
  score: number;
}

interface SuggestionListProps {
  suggestions: SuggestionItem[];
  attendedHasherIds: Set<string>;
  onSelect: (hasherId: string) => void;
  disabled?: boolean;
}

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
      <p className="text-xs font-medium text-muted-foreground">
        Suggestions
        {hiddenCount > 0 && (
          <span className="ml-1 font-normal">(+{hiddenCount} more)</span>
        )}
      </p>
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
