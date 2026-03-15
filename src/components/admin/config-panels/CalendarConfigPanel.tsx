"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KennelPatternsEditor } from "./KennelPatternsEditor";
import { SuggestionChips } from "./SuggestionChips";
import { KennelTagInput, type KennelOption } from "./KennelTagInput";
import { PatternFieldSections } from "./PatternFieldSections";

export interface CalendarConfig {
  kennelPatterns?: [string, string][];
  defaultKennelTag?: string;
  harePatterns?: string[];
  runNumberPatterns?: string[];
  descriptionSuffix?: string;
}

interface CalendarConfigPanelProps {
  config: CalendarConfig | null;
  onChange: (config: CalendarConfig) => void;
  /** Unmatched kennel tags from preview or open alerts — used to generate suggestions */
  unmatchedTags?: string[];
  /** Sample event titles per unmatched tag — passed through to SuggestionChips for AI enhance */
  sampleTitlesByTag?: Record<string, string[]>;
  /** Sample event descriptions from preview — used for AI field pattern suggestions */
  sampleDescriptions?: string[];
  /** Whether GEMINI_API_KEY is configured */
  geminiAvailable?: boolean;
  allKennels?: KennelOption[];
}

export function CalendarConfigPanel({
  config,
  onChange,
  unmatchedTags = [],
  sampleTitlesByTag,
  sampleDescriptions = [],
  geminiAvailable,
  allKennels,
}: CalendarConfigPanelProps) {
  const current = config ?? {};

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="defaultKennelTag">Default Kennel Tag</Label>
        <KennelTagInput
          id="defaultKennelTag"
          value={current.defaultKennelTag ?? ""}
          onChange={(v) =>
            onChange({ ...current, defaultKennelTag: v || undefined })
          }
          allKennels={allKennels}
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
          allKennels={allKennels}
        />
        <SuggestionChips
          unmatchedTags={unmatchedTags}
          existingPatterns={current.kennelPatterns ?? []}
          onAccept={(pattern) =>
            onChange({
              ...current,
              kennelPatterns: [...(current.kennelPatterns ?? []), pattern],
            })
          }
          sampleTitlesByTag={sampleTitlesByTag}
          geminiAvailable={geminiAvailable}
        />
      </div>
      <PatternFieldSections
        config={current}
        onChange={(updates) => onChange({ ...current, ...updates })}
        sampleDescriptions={sampleDescriptions}
        geminiAvailable={geminiAvailable}
        hareDefaultsHint="Hare:/Hares:/Who:"
        runNumberDefaultsHint="#N in summary, BH3-specific fallback"
      />
      <div className="space-y-2">
        <Label htmlFor="descriptionSuffix">Description Suffix</Label>
        <Textarea
          id="descriptionSuffix"
          value={current.descriptionSuffix ?? ""}
          onChange={(e) =>
            onChange({ ...current, descriptionSuffix: e.target.value || undefined })
          }
          placeholder="e.g., Check the Facebook page for details: https://..."
          rows={2}
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Text appended to every event description. Useful for sources where the
          calendar is sparse and a Facebook page or website has more details.
        </p>
      </div>
    </div>
  );
}
