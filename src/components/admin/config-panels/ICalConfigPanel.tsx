"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { KennelPatternsEditor } from "./KennelPatternsEditor";
import { StringArrayEditor } from "./StringArrayEditor";

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
        <StringArrayEditor
          items={current.skipPatterns ?? []}
          onChange={(patterns) =>
            onChange({
              ...current,
              skipPatterns: patterns.length > 0 ? patterns : undefined,
            })
          }
          placeholder="Regex pattern to skip"
          addLabel="Add Skip Pattern"
        />
      </div>
    </div>
  );
}
