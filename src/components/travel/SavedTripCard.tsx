"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Trash2, Clock } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatDateCompact, daysBetween } from "@/lib/travel/format";
import { deleteTravelSearch } from "@/app/travel/actions";

interface SavedTripCardProps {
  id: string;
  destination: {
    label: string;
    latitude: number;
    longitude: number;
    timezone: string | null;
    radiusKm: number;
    startDate: Date;
    endDate: Date;
  };
  status: "soon" | "active";
  /** When non-null, render live counts. Null = search failed; render without counts. */
  counts: { confirmed: number; likely: number; possible: number } | null;
}

const STATUS_META: Record<SavedTripCardProps["status"], { dot: string; label: string }> = {
  soon: {
    dot: "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]",
    label: "Trip starts soon",
  },
  active: {
    dot: "bg-emerald-500/80",
    label: "Saved",
  },
};

export function SavedTripCard({ id, destination, status, counts }: SavedTripCardProps) {
  const router = useRouter();
  const [isDeleting, startDelete] = useTransition();
  const [open, setOpen] = useState(false);

  const startStr = destination.startDate.toISOString().slice(0, 10);
  const endStr = destination.endDate.toISOString().slice(0, 10);
  const nights = daysBetween(startStr, endStr);

  const viewHref = buildTravelHref(destination);

  const handleDelete = () => {
    startDelete(async () => {
      const result = await deleteTravelSearch(id);
      if ("success" in result && result.success) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  const meta = STATUS_META[status];

  return (
    <article
      className="
        group relative overflow-hidden rounded-xl border border-border
        bg-card transition-all duration-200
        hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-lg
      "
    >
      {/* Pin-color accent stripe — gradient placeholder until per-destination region color is threaded */}
      <div className="h-1 bg-gradient-to-r from-emerald-500 via-sky-500 to-emerald-500" />

      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-display text-xl font-medium tracking-tight">
              {destination.label}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              <span>{formatDateCompact(startStr, { withWeekday: true })}</span>
              <span>→</span>
              <span>{formatDateCompact(endStr, { withWeekday: true })}</span>
              <span>·</span>
              <span>
                {nights} night{nights !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          <span
            className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-muted/50 px-2 py-1 text-[11px] font-medium text-muted-foreground"
            title={meta.label}
          >
            <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden="true" />
            {status === "soon" ? "Soon" : "Saved"}
          </span>
        </div>

        {/* Live counts */}
        {counts && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <CountPill
              count={counts.confirmed}
              label="confirmed"
              dotClass="bg-emerald-500"
            />
            <CountPill
              count={counts.likely}
              label="likely"
              dotClass="bg-sky-500"
            />
            {counts.possible > 0 && (
              <CountPill
                count={counts.possible}
                label="possible"
                dotClass="bg-zinc-400"
              />
            )}
          </div>
        )}
        {counts === null && (
          <div className="flex items-center gap-1.5 text-xs italic text-muted-foreground/60">
            <Clock className="h-3 w-3" />
            Counts unavailable — open the trip to refresh
          </div>
        )}

        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <Button asChild size="sm" className="gap-2">
            <Link href={viewHref}>
              View trip
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>

          <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground hover:text-destructive"
                aria-label="Delete saved trip"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this saved trip?</AlertDialogTitle>
                <AlertDialogDescription>
                  Removes &ldquo;{destination.label}&rdquo; from your saved
                  trips. The events themselves stay on HashTracks — you can
                  search for them again any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeleting ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </article>
  );
}

function CountPill({
  count,
  label,
  dotClass,
}: {
  count: number;
  label: string;
  dotClass: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      <span className="font-mono text-sm tabular-nums text-foreground">{count}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

/**
 * Build a `/travel?…` URL that re-runs the saved search. Mirrors the param
 * names that page.tsx parses, so the destination + dates + radius round-trip
 * cleanly.
 */
function buildTravelHref(destination: SavedTripCardProps["destination"]): string {
  const params = new URLSearchParams({
    lat: destination.latitude.toString(),
    lng: destination.longitude.toString(),
    from: destination.startDate.toISOString().slice(0, 10),
    to: destination.endDate.toISOString().slice(0, 10),
    q: destination.label,
    r: destination.radiusKm.toString(),
  });
  if (destination.timezone) params.set("tz", destination.timezone);
  return `/travel?${params.toString()}`;
}
