"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { mergeRegions, type MergePreview } from "@/app/admin/regions/actions";
import { useRouter } from "next/navigation";
import type { RegionRow } from "./RegionTable";

type Step = "select" | "preview" | "done";

export function RegionMergeDialog({
  regions,
  onClose,
}: {
  regions: RegionRow[];
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("select");
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handlePreview() {
    if (!sourceId || !targetId) {
      toast.error("Select both source and target regions");
      return;
    }
    if (sourceId === targetId) {
      toast.error("Cannot merge a region into itself");
      return;
    }

    startTransition(async () => {
      const result = await mergeRegions(sourceId, targetId, true);
      if (result.error) {
        toast.error(result.error);
      } else if (result.preview) {
        setPreview(result.preview);
        setStep("preview");
      }
    });
  }

  function handleExecute() {
    startTransition(async () => {
      const result = await mergeRegions(sourceId, targetId, false);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(
          `Merged "${preview?.source.name}" into "${preview?.target.name}"`,
        );
        router.refresh();
        onClose();
      }
    });
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Merge Regions</DialogTitle>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              All kennels from the source region will be moved to the target
              region. The source region will be deleted.
            </p>

            <div className="space-y-2">
              <Label>Merge from (source)</Label>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source region..." />
                </SelectTrigger>
                <SelectContent>
                  {regions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} ({r.kennels.length} kennels)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Merge into (target)</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select target region..." />
                </SelectTrigger>
                <SelectContent>
                  {regions
                    .filter((r) => r.id !== sourceId)
                    .map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} ({r.kennels.length} kennels)
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={handlePreview}
                disabled={!sourceId || !targetId || isPending}
              >
                {isPending ? "Loading..." : "Preview"}
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && preview && (
          <div className="space-y-4">
            <div className="rounded-md border p-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Source:</span>
                <span className="font-medium">
                  {preview.source.name} ({preview.source.kennelCount} kennels)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Target:</span>
                <span className="font-medium">
                  {preview.target.name} ({preview.target.kennelCount} kennels)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">After merge:</span>
                <span className="font-medium">
                  {preview.source.kennelCount + preview.target.kennelCount} kennels in {preview.target.name}
                </span>
              </div>
            </div>

            {preview.affectedKennels.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Kennels being moved:</p>
                <div className="flex flex-wrap gap-1">
                  {preview.affectedKennels.map((k) => (
                    <Badge key={k.id} variant="outline" className="text-xs">
                      {k.shortName}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {preview.conflicts.length > 0 && (
              <div className="rounded-md border border-destructive p-3 space-y-1">
                <p className="text-sm font-medium text-destructive">
                  Name collisions detected:
                </p>
                <p className="text-xs text-muted-foreground">
                  These kennels exist in both regions. Merge cannot proceed.
                </p>
                <div className="flex flex-wrap gap-1">
                  {preview.conflicts.map((name) => (
                    <Badge key={name} variant="destructive" className="text-xs">
                      {name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep("select")}>
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={handleExecute}
                disabled={preview.conflicts.length > 0 || isPending}
              >
                {isPending ? "Merging..." : "Merge"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
