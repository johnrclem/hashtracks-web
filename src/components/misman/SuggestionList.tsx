"use client";

import { Button } from "@/components/ui/button";

interface SuggestionItem {
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

export function SuggestionList({
  suggestions,
  attendedHasherIds,
  onSelect,
  disabled,
}: SuggestionListProps) {
  const available = suggestions.filter(
    (s) => !attendedHasherIds.has(s.kennelHasherId),
  );

  if (available.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">Suggestions</p>
      <div className="flex flex-wrap gap-1.5">
        {available.map((s) => (
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
