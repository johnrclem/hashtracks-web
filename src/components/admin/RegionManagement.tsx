"use client";

import { useState } from "react";
import { RegionTable, type RegionRow } from "./RegionTable";
import { RegionSuggestionsPanel } from "./RegionSuggestionsPanel";
import { RegionMergeDialog } from "./RegionMergeDialog";
import { RegionFormDialog } from "./RegionFormDialog";
import type { SuggestionType } from "@/app/admin/regions/actions";

export function RegionManagement({ regions }: Readonly<{ regions: RegionRow[] }>) {
  const [showCreate, setShowCreate] = useState(false);
  const [editRegion, setEditRegion] = useState<RegionRow | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState<string | undefined>();
  const [mergeTargetId, setMergeTargetId] = useState<string | undefined>();

  function handleSuggestionAction(type: SuggestionType, regionIds: string[]) {
    if (type === "merge") {
      if (regionIds.length >= 2) {
        setMergeSourceId(regionIds[0]);
        setMergeTargetId(regionIds[1]);
        setShowMerge(true);
      }
      return;
    }
    if (regionIds.length >= 1) {
      const region = regions.find((r) => r.id === regionIds[0]);
      if (region) setEditRegion(region);
    }
  }

  function handleEditRegion(region: RegionRow) {
    setEditRegion(region);
  }

  function handleMergeRegions() {
    setMergeSourceId(undefined);
    setMergeTargetId(undefined);
    setShowMerge(true);
  }

  function closeMerge() {
    setShowMerge(false);
    setMergeSourceId(undefined);
    setMergeTargetId(undefined);
  }

  return (
    <div className="space-y-6">
      <RegionTable
        regions={regions}
        onCreateRegion={() => setShowCreate(true)}
        onEditRegion={handleEditRegion}
        onMergeRegions={handleMergeRegions}
      />
      <RegionSuggestionsPanel
        regions={regions}
        onAction={handleSuggestionAction}
      />

      {showCreate && (
        <RegionFormDialog
          regions={regions}
          onClose={() => setShowCreate(false)}
        />
      )}

      {editRegion && (
        <RegionFormDialog
          region={editRegion}
          regions={regions}
          onClose={() => setEditRegion(null)}
        />
      )}

      {showMerge && (
        <RegionMergeDialog
          regions={regions}
          initialSourceId={mergeSourceId}
          initialTargetId={mergeTargetId}
          onClose={closeMerge}
        />
      )}
    </div>
  );
}
