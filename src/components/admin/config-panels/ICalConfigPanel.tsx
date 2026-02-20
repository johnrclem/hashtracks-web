"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KennelPatternsEditor } from "./KennelPatternsEditor";

export interface ICalConfig {
  kennelPatterns?: [string, string][];
  defaultKennelTag?: string;
  skipPatterns?: string[];
}

interface ICalConfigPanelProps {
  config: ICalConfig | null;
  onChange: (config: ICalConfig) => void;
}

export function ICalConfigPanel({ config, onChange }: ICalConfigPanelProps) {
  const current = config ?? {};
  const skipPatterns = current.skipPatterns ?? [];

  function addSkipPattern() {
    onChange({ ...current, skipPatterns: [...skipPatterns, ""] });
  }

  function removeSkipPattern(index: number) {
    const updated = skipPatterns.filter((_, i) => i !== index);
    onChange({
      ...current,
      skipPatterns: updated.length > 0 ? updated : undefined,
    });
  }

  function updateSkipPattern(index: number, value: string) {
    const updated = skipPatterns.map((p, i) => (i === index ? value : p));
    onChange({ ...current, skipPatterns: updated });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="defaultKennelTag">Default Kennel Tag</Label>
        <Input
          id="defaultKennelTag"
          value={current.defaultKennelTag ?? ""}
          onChange={(e) =>
            onChange({
              ...current,
              defaultKennelTag: e.target.value || undefined,
            })
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
          First match wins. Leave empty for single-kennel feeds.
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
      </div>

      <div className="space-y-2">
        <Label>Skip Patterns</Label>
        <p className="text-xs text-muted-foreground">
          Regex patterns to exclude events by title (e.g., &quot;Hand
          Pump&quot;, &quot;Workday&quot;).
        </p>
        <div className="space-y-2">
          {skipPatterns.map((pattern, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder="Regex pattern to skip"
                value={pattern}
                onChange={(e) => updateSkipPattern(i, e.target.value)}
                className="flex-1 font-mono text-xs"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeSkipPattern(i)}
              >
                &times;
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addSkipPattern}
          >
            Add Skip Pattern
          </Button>
        </div>
      </div>
    </div>
  );
}
