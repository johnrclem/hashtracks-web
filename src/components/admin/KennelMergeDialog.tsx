"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeKennels } from "@/app/admin/kennels/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Kennel {
  id: string;
  shortName: string;
  slug: string;
}

interface MergePreviewData {
  source: { id: string; shortName: string; slug: string };
  target: { id: string; shortName: string; slug: string };
  counts: {
    events: number;
    subscriptions: number;
    rosterEntries: number;
    mismanRequests: number;
    sourceLinks: number;
    aliases: number;
  };
  conflicts: Array<{
    type: "event_date" | "other";
    message: string;
    details?: string[];
  }>;
}

interface KennelMergeDialogProps {
  kennels: Kennel[];
  trigger?: React.ReactNode;
}

type Step = "select" | "preview" | "executing";

export function KennelMergeDialog({ kennels, trigger }: KennelMergeDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("select");
  const [sourceKennelId, setSourceKennelId] = useState<string>("");
  const [targetKennelId, setTargetKennelId] = useState<string>("");
  const [preview, setPreview] = useState<MergePreviewData | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleReset = () => {
    setStep("select");
    setSourceKennelId("");
    setTargetKennelId("");
    setPreview(null);
  };

  const handlePreview = async () => {
    if (!sourceKennelId || !targetKennelId) {
      toast.error("Please select both source and target kennels");
      return;
    }

    if (sourceKennelId === targetKennelId) {
      toast.error("Source and target must be different kennels");
      return;
    }

    startTransition(async () => {
      const result = await mergeKennels(sourceKennelId, targetKennelId, true);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      if (result.preview) {
        setPreview(result.preview);
        setStep("preview");
      }
    });
  };

  const handleExecute = async () => {
    if (!sourceKennelId || !targetKennelId) return;

    startTransition(async () => {
      setStep("executing");
      const result = await mergeKennels(sourceKennelId, targetKennelId, false);

      if (result.error) {
        toast.error(result.error);
        setStep("preview");
        return;
      }

      if (result.success) {
        toast.success("Kennels merged successfully!");
        setOpen(false);
        handleReset();
        router.refresh();
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen);
      if (!isOpen) handleReset();
    }}>
      <DialogTrigger asChild>
        {trigger || <Button variant="outline">Merge Kennels</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {step === "select" && (
          <>
            <DialogHeader>
              <DialogTitle>Merge Kennels</DialogTitle>
              <DialogDescription>
                Merge two duplicate kennels by moving all records from the source kennel to the target kennel.
                The source kennel will be deleted.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              <div className="space-y-2">
                <Label htmlFor="source-kennel">
                  Source Kennel <span className="text-destructive">(will be deleted)</span>
                </Label>
                <Select value={sourceKennelId} onValueChange={setSourceKennelId}>
                  <SelectTrigger id="source-kennel">
                    <SelectValue placeholder="Select kennel to merge from..." />
                  </SelectTrigger>
                  <SelectContent>
                    {kennels.map((kennel) => (
                      <SelectItem key={kennel.id} value={kennel.id}>
                        {kennel.shortName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="target-kennel">
                  Target Kennel <span className="text-muted-foreground">(will keep)</span>
                </Label>
                <Select value={targetKennelId} onValueChange={setTargetKennelId}>
                  <SelectTrigger id="target-kennel">
                    <SelectValue placeholder="Select kennel to merge to..." />
                  </SelectTrigger>
                  <SelectContent>
                    {kennels.map((kennel) => (
                      <SelectItem key={kennel.id} value={kennel.id}>
                        {kennel.shortName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handlePreview} disabled={isPending || !sourceKennelId || !targetKennelId}>
                {isPending ? "Loading..." : "Preview Merge"}
              </Button>
            </div>
          </>
        )}

        {step === "preview" && preview && (
          <>
            <DialogHeader>
              <DialogTitle>Merge Preview</DialogTitle>
              <DialogDescription>
                Review the changes before proceeding. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Source:</span>
                  <span className="text-sm">
                    {preview.source.shortName} <span className="text-muted-foreground">({preview.source.id})</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Target:</span>
                  <span className="text-sm">
                    {preview.target.shortName} <span className="text-muted-foreground">({preview.target.id})</span>
                  </span>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-3">Records to reassign:</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
                    <span className="text-sm">Events</span>
                    <Badge variant="secondary">{preview.counts.events}</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
                    <span className="text-sm">Subscriptions</span>
                    <Badge variant="secondary">{preview.counts.subscriptions}</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
                    <span className="text-sm">Roster entries</span>
                    <Badge variant="secondary">{preview.counts.rosterEntries}</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
                    <span className="text-sm">Misman requests</span>
                    <Badge variant="secondary">{preview.counts.mismanRequests}</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
                    <span className="text-sm">Source links</span>
                    <Badge variant="secondary">{preview.counts.sourceLinks}</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
                    <span className="text-sm">Aliases</span>
                    <Badge variant="secondary">{preview.counts.aliases}</Badge>
                  </div>
                </div>
              </div>

              {preview.conflicts.length > 0 && (
                <div className="rounded-lg border border-destructive bg-destructive/10 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-destructive">⚠️ Conflicts detected:</span>
                  </div>
                  {preview.conflicts.map((conflict, idx) => (
                    <div key={idx} className="text-sm space-y-1">
                      <p className="font-medium">{conflict.message}</p>
                      {conflict.details && conflict.details.length > 0 && (
                        <ul className="list-disc list-inside text-muted-foreground ml-4">
                          {conflict.details.slice(0, 5).map((detail, i) => (
                            <li key={i}>{detail}</li>
                          ))}
                          {conflict.details.length > 5 && (
                            <li>...and {conflict.details.length - 5} more</li>
                          )}
                        </ul>
                      )}
                    </div>
                  ))}
                  <p className="text-sm text-muted-foreground mt-2">
                    Manual resolution required. Cannot proceed with merge.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleReset}>
                Back
              </Button>
              <Button
                onClick={handleExecute}
                disabled={isPending || preview.conflicts.length > 0}
                variant={preview.conflicts.length > 0 ? "secondary" : "destructive"}
              >
                {isPending ? "Merging..." : "Execute Merge"}
              </Button>
            </div>
          </>
        )}

        {step === "executing" && (
          <>
            <DialogHeader>
              <DialogTitle>Merging Kennels...</DialogTitle>
              <DialogDescription>
                Please wait while we merge the kennels. This may take a moment.
              </DialogDescription>
            </DialogHeader>
            <div className="py-8 flex items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
