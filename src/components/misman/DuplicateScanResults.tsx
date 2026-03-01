"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { scanDuplicates } from "@/app/misman/[slug]/roster/actions";
import { MergePreviewDialog } from "./MergePreviewDialog";

interface DuplicatePair {
  hasherId1: string;
  name1: string;
  hasherId2: string;
  name2: string;
  score: number;
  matchField: string;
}

interface DuplicateScanResultsProps {
  kennelId: string;
  kennelSlug: string;
}

export function DuplicateScanResults({
  kennelId,
  kennelSlug,
}: DuplicateScanResultsProps) {
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null);
  const [scanning, startScan] = useTransition();
  const [mergeTarget, setMergeTarget] = useState<DuplicatePair | null>(null);

  function handleScan() {
    startScan(async () => {
      const result = await scanDuplicates(kennelId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setPairs(result.data ?? []);
      if (result.data?.length === 0) {
        toast.success("No duplicates found");
      }
    });
  }

  return (
    <div>
      <Button
        size="sm"
        variant="outline"
        onClick={handleScan}
        disabled={scanning}
      >
        {scanning ? "Scanning..." : "Scan for Duplicates"}
      </Button>

      {pairs !== null && pairs.length > 0 && (
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold">
            Potential Duplicates ({pairs.length})
          </h3>
          {pairs.map((pair, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{pair.name1}</span>
                <span className="text-muted-foreground">↔</span>
                <span className="font-medium">{pair.name2}</span>
                <Badge variant="secondary" className="text-xs">
                  {Math.round(pair.score * 100)}%
                </Badge>
                <span className="text-xs text-muted-foreground">
                  ({pair.matchField})
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMergeTarget(pair)}
              >
                Merge
              </Button>
            </div>
          ))}
        </div>
      )}

      {mergeTarget && (
        <MergePreviewDialog
          open={!!mergeTarget}
          onClose={() => setMergeTarget(null)}
          kennelId={kennelId}
          kennelSlug={kennelSlug}
          hasherId1={mergeTarget.hasherId1}
          name1={mergeTarget.name1}
          hasherId2={mergeTarget.hasherId2}
          name2={mergeTarget.name2}
        />
      )}
    </div>
  );
}
