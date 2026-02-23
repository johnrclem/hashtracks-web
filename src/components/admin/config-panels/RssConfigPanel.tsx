"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface RssConfig {
  kennelTag?: string; // Kennel shortName all items from this feed are assigned to
}

interface RssConfigPanelProps {
  readonly config: RssConfig | null;
  readonly onChange: (config: RssConfig) => void;
}

/**
 * Config panel for RSS_FEED sources.
 * All items from the feed are assigned to a single kennel.
 */
export function RssConfigPanel({ config, onChange }: RssConfigPanelProps) {
  const kennelTag = config?.kennelTag ?? "";

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="rss-kennel-tag">Kennel Tag</Label>
        <Input
          id="rss-kennel-tag"
          value={kennelTag}
          onChange={(e) => { onChange({ ...config, kennelTag: e.target.value }); }}
          placeholder="e.g. EWH3"
        />
        <p className="text-xs text-muted-foreground">
          All items from this feed will be assigned to this kennel. Must match a kennel
          shortName or alias in the system.
        </p>
      </div>
    </div>
  );
}
