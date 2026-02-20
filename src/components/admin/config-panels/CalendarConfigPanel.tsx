"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KennelPatternsEditor } from "./KennelPatternsEditor";
import { suggestKennelPatterns } from "@/lib/source-detect";

export interface CalendarConfig {
  kennelPatterns?: [string, string][];
  defaultKennelTag?: string;
}

interface CalendarConfigPanelProps {
  config: CalendarConfig | null;
  onChange: (config: CalendarConfig) => void;
  /** Unmatched kennel tags from preview or open alerts — used to generate suggestions */
  unmatchedTags?: string[];
}

export function CalendarConfigPanel({
  config,
  onChange,
  unmatchedTags = [],
}: CalendarConfigPanelProps) {
  const current = config ?? {};
  const suggestions = suggestKennelPatterns(
    unmatchedTags.filter(
      (tag) => !(current.kennelPatterns ?? []).some(([, t]) => t === tag),
    ),
  );
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const pendingSuggestions = suggestions.filter(([, tag]) => !dismissed.has(tag));

  function acceptSuggestion(pattern: [string, string]) {
    onChange({
      ...current,
      kennelPatterns: [...(current.kennelPatterns ?? []), pattern],
    });
    setDismissed((prev) => new Set([...prev, pattern[1]]));
  }

  function dismissSuggestion(tag: string) {
    setDismissed((prev) => new Set([...prev, tag]));
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="defaultKennelTag">Default Kennel Tag</Label>
        <Input
          id="defaultKennelTag"
          value={current.defaultKennelTag ?? ""}
          onChange={(e) =>
            onChange({ ...current, defaultKennelTag: e.target.value || undefined })
          }
          placeholder="e.g., EWH3"
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Fallback kennel tag when no pattern matches an event title.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Kennel Patterns</Label>
        <p className="text-xs text-muted-foreground">
          Regex patterns matched against event titles to determine kennel tag.
          First match wins. Leave empty for single-kennel calendars.
        </p>
        <KennelPatternsEditor
          patterns={current.kennelPatterns ?? []}
          onChange={(patterns) =>
            onChange({
              ...current,
              kennelPatterns: patterns.length > 0 ? patterns : undefined,
            })
          }
        />

        {pendingSuggestions.length > 0 && (
          <div className="space-y-1 pt-1">
            <p className="text-xs font-medium text-amber-700">
              Suggested patterns for unmatched tags:
            </p>
            <div className="flex flex-wrap gap-1">
              {pendingSuggestions.map(([pattern, tag]) => (
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
                    onClick={() => acceptSuggestion([pattern, tag])}
                  >
                    ✓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive"
                    title="Dismiss"
                    onClick={() => dismissSuggestion(tag)}
                  >
                    &times;
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
