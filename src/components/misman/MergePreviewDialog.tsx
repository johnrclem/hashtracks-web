"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { previewMerge, executeMerge } from "@/app/misman/[slug]/roster/actions";

interface MergePreviewDialogProps {
  open: boolean;
  onClose: () => void;
  kennelId: string;
  kennelSlug: string;
  hasherId1: string;
  name1: string;
  hasherId2: string;
  name2: string;
}

interface HasherPreview {
  id: string;
  hashName: string | null;
  nerdName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  attendanceCount: number;
  hasLink: boolean;
}

interface PreviewData {
  primary: HasherPreview;
  secondaries: HasherPreview[];
  totalAttendance: number;
  overlapCount: number;
  hasConflictingLinks: boolean;
}

export function MergePreviewDialog({
  open,
  onClose,
  kennelId,
  kennelSlug,
  hasherId1,
  name1,
  hasherId2,
  name2,
}: MergePreviewDialogProps) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [primaryId, setPrimaryId] = useState(hasherId1);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const secondaryId = primaryId === hasherId1 ? hasherId2 : hasherId1;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    previewMerge(kennelId, primaryId, [secondaryId]).then((result) => {
      if (result.error) {
        toast.error(result.error);
        onClose();
        return;
      }
      setPreview(result.data ?? null);
      setLoading(false);
    });
  }, [open, kennelId, primaryId, secondaryId, onClose]);

  function handleMerge() {
    if (!preview) return;
    const secondary = preview.secondaries[0];
    startTransition(async () => {
      const result = await executeMerge(kennelId, primaryId, [secondaryId], {
        hashName: preview.primary.hashName ?? undefined,
        nerdName: preview.primary.nerdName ?? secondary?.nerdName ?? undefined,
        email: preview.primary.email ?? secondary?.email ?? undefined,
        phone: preview.primary.phone ?? secondary?.phone ?? undefined,
        notes: preview.primary.notes ?? secondary?.notes ?? undefined,
      });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Merged ${result.mergedCount} duplicate(s)`);
        onClose();
        router.refresh();
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Merge Preview</AlertDialogTitle>
        </AlertDialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Loading preview...
          </div>
        ) : preview ? (
          <div className="space-y-4">
            {/* Primary selector */}
            <div className="text-sm">
              <span className="text-muted-foreground">Keep as primary:</span>
              <div className="mt-1 flex gap-2">
                <Button
                  size="sm"
                  variant={primaryId === hasherId1 ? "default" : "outline"}
                  onClick={() => setPrimaryId(hasherId1)}
                >
                  {name1}
                </Button>
                <Button
                  size="sm"
                  variant={primaryId === hasherId2 ? "default" : "outline"}
                  onClick={() => setPrimaryId(hasherId2)}
                >
                  {name2}
                </Button>
              </div>
            </div>

            {/* Stats */}
            <div className="rounded-lg border p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Combined attendance:</span>
                <span className="font-medium">{preview.totalAttendance} events</span>
              </div>
              {preview.overlapCount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Overlapping events:</span>
                  <span className="font-medium">{preview.overlapCount} (will OR-merge flags)</span>
                </div>
              )}
            </div>

            {/* Side-by-side comparison */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border p-2 space-y-1">
                <div className="font-semibold flex items-center gap-1">
                  Primary
                  {preview.primary.hasLink && <Badge className="text-xs">Linked</Badge>}
                </div>
                <div>{preview.primary.hashName || "—"}</div>
                <div className="text-muted-foreground text-xs">
                  {preview.primary.nerdName || "—"}
                </div>
                <div className="text-muted-foreground text-xs">
                  {preview.primary.email || "—"}
                </div>
                <div className="text-xs">{preview.primary.attendanceCount} runs</div>
              </div>
              {preview.secondaries.map((s) => (
                <div key={s.id} className="rounded-lg border p-2 space-y-1">
                  <div className="font-semibold flex items-center gap-1 text-destructive">
                    Will be merged
                    {s.hasLink && <Badge variant="secondary" className="text-xs">Linked</Badge>}
                  </div>
                  <div>{s.hashName || "—"}</div>
                  <div className="text-muted-foreground text-xs">
                    {s.nerdName || "—"}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {s.email || "—"}
                  </div>
                  <div className="text-xs">{s.attendanceCount} runs</div>
                </div>
              ))}
            </div>

            {/* Conflict warning */}
            {preview.hasConflictingLinks && (
              <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                These entries are linked to different users. Revoke one link before merging.
              </div>
            )}
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            onClick={handleMerge}
            disabled={isPending || loading || preview?.hasConflictingLinks}
            variant="destructive"
          >
            {isPending ? "Merging..." : "Confirm Merge"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
