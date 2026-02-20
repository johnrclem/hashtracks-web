"use client";

import { Label } from "@/components/ui/label";
import { StringArrayEditor } from "./StringArrayEditor";

export interface HashRegoConfig {
  kennelSlugs?: string[];
}

interface HashRegoConfigPanelProps {
  config: HashRegoConfig | null;
  onChange: (config: HashRegoConfig) => void;
}

export function HashRegoConfigPanel({
  config,
  onChange,
}: HashRegoConfigPanelProps) {
  const current = config ?? {};

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Kennel Slugs *</Label>
        <p className="text-xs text-muted-foreground">
          Hash Rego kennel identifiers to include. At least one is required.
          Slugs are auto-uppercased (e.g., &quot;bfmh3&quot; becomes
          &quot;BFMH3&quot;).
        </p>
        <StringArrayEditor
          items={current.kennelSlugs ?? []}
          onChange={(slugs) =>
            onChange({
              ...current,
              kennelSlugs: slugs.length > 0 ? slugs : undefined,
            })
          }
          placeholder="e.g., BFMH3"
          addLabel="Add Slug"
          transform={(v) => v.toUpperCase()}
        />
      </div>
    </div>
  );
}
