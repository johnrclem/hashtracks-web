"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { adminCancelEvent } from "@/app/admin/events/actions";
import { formatDateLong } from "@/lib/format";
import { toast } from "sonner";

const REASON_MIN = 3;
const REASON_MAX = 500;
const REASON_WARN_AT = REASON_MAX - 50;

interface CancellationOverrideDialogProps {
  /** The event being cancelled. */
  event: {
    id: string;
    title: string | null;
    /** ISO 8601 date string. */
    date: string;
    kennelShortName: string;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Admin confirmation dialog for the cancellation-override action. Captures a
 * required reason (3–500 chars), previews the audit trail line that will be
 * written, and calls `adminCancelEvent` on confirm. Closes itself on success;
 * stays open on error so the admin can retry without retyping the reason.
 *
 * Visual language: matches the project's shadcn/ui admin-dialog idiom (compare
 * KennelMergeDialog / RegionFormDialog). Distinctive details specific to this
 * action: a lock-icon motif that foreshadows the row's post-submit lock state,
 * and a live audit-trail preview that treats this as a deliberate ledger entry
 * rather than a transient confirmation.
 *
 * Spec: docs/superpowers/specs/2026-05-01-cancellation-override-design.md
 */
export function CancellationOverrideDialog({
  event,
  open,
  onOpenChange,
}: CancellationOverrideDialogProps) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Reset internal state every time the dialog opens for a new event so the
  // textarea doesn't carry over a stale draft from a previous (cancelled) flow.
  // The setState-in-effect pattern is intentional here: the alternatives
  // (key-based remount, per-event state map) add UX or code cost without
  // benefit for this single-instance dialog.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on open; see comment above
      setReason("");
      setTouched(false);
    }
  }, [open, event?.id]);

  const trimmed = reason.trim();
  const length = trimmed.length;
  const tooShort = length < REASON_MIN;
  const tooLong = length > REASON_MAX;
  const isValid = !tooShort && !tooLong;
  const showShortError = touched && tooShort;
  const nearLimit = length >= REASON_WARN_AT && length <= REASON_MAX;

  const counterClassName = tooLong
    ? "text-destructive"
    : nearLimit
      ? "text-amber-600 dark:text-amber-500"
      : showShortError
        ? "text-destructive"
        : "text-muted-foreground";

  const handleConfirm = () => {
    if (!event || !isValid) return;
    startTransition(async () => {
      const result = await adminCancelEvent(event.id, trimmed);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Cancelled ${result.kennelName} — ${formatDateLong(result.date)}`);
      onOpenChange(false);
      router.refresh();
    });
  };

  const auditPreviewDate = formatDateLong(new Date().toISOString());
  const auditPreviewReason = trimmed || "…your reason here";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return; // Don't allow Escape / overlay close mid-action.
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-muted"
            >
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <DialogTitle>Cancel this event</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            Marks the event cancelled with a required reason. The override
            survives every subsequent scrape, so a re-emitting source won&apos;t
            silently un-cancel it. Un-cancel from the same row menu.
          </DialogDescription>
        </DialogHeader>

        {event && (
          <div className="rounded-lg border bg-muted/40 p-3 space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{event.kennelShortName}</span>
              <span className="text-sm text-muted-foreground">
                {formatDateLong(event.date)}
              </span>
            </div>
            {event.title && (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {event.title}
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="cancellation-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <span className={`text-xs tabular-nums ${counterClassName}`}>
              {length} / {REASON_MAX}
            </span>
          </div>
          <Textarea
            id="cancellation-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="e.g. City bridge run conflict; kennel cancelled on FB."
            disabled={isPending}
            rows={3}
            aria-invalid={showShortError || tooLong}
            aria-describedby="cancellation-reason-help"
            className={
              showShortError || tooLong
                ? "border-destructive focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40"
                : ""
            }
          />
          <p
            id="cancellation-reason-help"
            className="text-xs text-muted-foreground"
          >
            {showShortError
              ? `Minimum ${REASON_MIN} characters.`
              : tooLong
                ? `Maximum ${REASON_MAX} characters.`
                : "Captured in the audit log; visible to admins on the row hover."}
          </p>
        </div>

        <div className="rounded-md border border-dashed bg-background px-3 py-2 text-xs text-muted-foreground">
          <span className="font-mono uppercase tracking-wide">
            Audit preview
          </span>
          <p className="mt-1 leading-relaxed">
            cancel by you on{" "}
            <span className="text-foreground/80">{auditPreviewDate}</span>:{" "}
            <em
              className={
                trimmed.length === 0
                  ? "text-muted-foreground/60"
                  : "text-foreground/90"
              }
            >
              &ldquo;{auditPreviewReason}&rdquo;
            </em>
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={!isValid || isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Cancelling…
              </>
            ) : (
              <>
                <Lock className="h-4 w-4" aria-hidden />
                Confirm cancellation
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
