"use client";

import { useState } from "react";
import { RegionTable, type RegionRow } from "./RegionTable";
import { RegionSuggestionsPanel } from "./RegionSuggestionsPanel";
import { RegionMergeDialog } from "./RegionMergeDialog";
import { RegionFormDialog } from "./RegionFormDialog";
import type { SuggestionType } from "@/app/admin/regions/actions";

export function RegionManagement({ regions }: Readonly<{ regions: RegionRow[] }>) {
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [editRegionId, setEditRegionId] = useState<string | null>(null);

  function handleSuggestionAction(type: SuggestionType, regionIds: string[]) {
    if (type === "merge" && regionIds.length >= 2) {
      setMergeSourceId(regionIds[0]);
      setMergeTargetId(regionIds[1]);
    } else if (regionIds.length >= 1) {
      setEditRegionId(regionIds[0]);
    }
  }

  const editRegion = editRegionId
    ? regions.find((r) => r.id === editRegionId) ?? null
    : null;

  return (
    <div className="space-y-6">
      <RegionTable regions={regions} />
      <RegionSuggestionsPanel
        regions={regions}
        onAction={handleSuggestionAction}
      />

      {mergeSourceId && mergeTargetId && (
        <RegionMergeDialog
          regions={regions}
          initialSourceId={mergeSourceId}
          initialTargetId={mergeTargetId}
          onClose={() => {
            setMergeSourceId(null);
            setMergeTargetId(null);
          }}
        />
      )}

      {editRegion && (
        <RegionFormDialog
          region={editRegion}
          regions={regions}
          onClose={() => setEditRegionId(null)}
        />
      )}
    </div>
  );
}
