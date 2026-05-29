"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crown, Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { KennelCombobox } from "./KennelCombobox";
import {
  reattributeEventKennel,
  addCoHostKennel,
  removeCoHostKennel,
} from "@/app/admin/events/actions";
import { formatDateLong } from "@/lib/format";
import { toast } from "sonner";

export interface EventKennelInfo {
  readonly kennelCode: string;
  readonly shortName: string;
  readonly isPrimary: boolean;
}

interface KennelAttributionDialogProps {
  readonly event: {
    readonly id: string;
    readonly title: string | null;
    /** ISO 8601 date string. */
    readonly date: string;
    readonly kennels: readonly EventKennelInfo[];
  } | null;
  readonly kennels: readonly {
    readonly kennelCode: string;
    readonly shortName: string;
    readonly fullName: string;
  }[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Admin dialog for an event's kennel attribution (#1680). Supports three
 * operations against the EventKennel join: change the PRIMARY kennel (a move
 * that drops the old kennel), add a co-host, and remove a co-host. Each
 * mutation closes the dialog and refreshes; reopen to chain another change.
 */
export function KennelAttributionDialog({
  event,
  kennels,
  open,
  onOpenChange,
}: KennelAttributionDialogProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const eventKennels = event?.kennels ?? [];
  const primary = eventKennels.find((k) => k.isPrimary);
  const coHosts = eventKennels.filter((k) => !k.isPrimary);
  const attachedCodes = eventKennels.map((k) => k.kennelCode);

  // Generic runner: T is inferred per action, so each successMessage callback
  // sees that action's exact success fields — no discriminated-union checks.
  function runMutation<T>(
    fn: () => Promise<({ success: true } & T) | { error: string }>,
    successMessage: (r: T) => string,
  ) {
    startTransition(async () => {
      const r = await fn();
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      toast.success(successMessage(r));
      onOpenChange(false);
      router.refresh();
    });
  }

  function handleChangePrimary(kennelCode: string) {
    if (!event) return;
    runMutation(
      () => reattributeEventKennel(event.id, kennelCode),
      (r) => `Moved ${r.oldKennelName} → ${r.newKennelName}`,
    );
  }

  function handleAddCoHost(kennelCode: string) {
    if (!event) return;
    runMutation(
      () => addCoHostKennel(event.id, kennelCode),
      (r) => `Added co-host ${r.kennelName}`,
    );
  }

  function handleRemoveCoHost(kennelCode: string) {
    if (!event) return;
    runMutation(
      () => removeCoHostKennel(event.id, kennelCode),
      (r) => `Removed co-host ${r.kennelName}`,
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Kennel attribution</DialogTitle>
          <DialogDescription className="pt-1">
            Change the primary kennel (a move — the old kennel is dropped), or
            add and remove co-hosts. Each change is audit-logged.
          </DialogDescription>
        </DialogHeader>

        {event && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-3 space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">
                  {primary?.shortName ?? "—"}
                </span>
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

            {/* Change primary */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1 text-xs">
                <Crown className="h-3 w-3" /> Primary kennel
              </Label>
              <KennelCombobox
                kennels={kennels}
                value={primary?.kennelCode}
                onSelect={handleChangePrimary}
                disabled={isPending}
                placeholder="Change primary kennel…"
                excludeCodes={primary ? [primary.kennelCode] : []}
              />
            </div>

            {/* Co-hosts */}
            <div className="space-y-1.5">
              <Label className="text-xs">Co-hosts</Label>
              {coHosts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No co-hosts.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {coHosts.map((c) => (
                    <Badge
                      key={c.kennelCode}
                      variant="secondary"
                      className="gap-1 pr-1 text-xs"
                    >
                      {c.shortName}
                      <button
                        type="button"
                        aria-label={`Remove co-host ${c.shortName}`}
                        disabled={isPending}
                        onClick={() => handleRemoveCoHost(c.kennelCode)}
                        className="rounded-sm p-0.5 hover:bg-muted-foreground/20 disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <KennelCombobox
                kennels={kennels}
                onSelect={handleAddCoHost}
                disabled={isPending}
                placeholder="Add co-host…"
                excludeCodes={attachedCodes}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Working…
              </>
            ) : (
              "Done"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
