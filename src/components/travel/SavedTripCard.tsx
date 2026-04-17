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
import { buildTravelSearchUrl, utcYmd } from "@/lib/travel/url";
import { capture } from "@/lib/analytics";
import { deleteTravelSearch, viewTravelSearch } from "@/app/travel/actions";

/** Status of a saved trip relative to today. Shared with /travel/saved page. */
export type SavedTripStatus = "soon" | "active";

interface SavedTripCardProps {
  id: string;
  createdAt: Date;
  destination: {
    label: string;
    latitude: number;
    longitude: number;
    timezone: string | null;
    radiusKm: number;
    startDate: Date;
    endDate: Date;
  };
  status: SavedTripStatus;
  /** When non-null, render live counts. Null = search failed; render without counts. */
  counts: { confirmed: number; likely: number; possible: number } | null;
}

const STATUS_META: Record<SavedTripStatus, { dot: string; label: string }> = {
  soon: {
    dot: "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]",
    label: "Trip starts soon",
  },
  active: {
    dot: "bg-emerald-500/80",
    label: "Saved",
  },
};

export function SavedTripCard({
  id,
  createdAt,
  destination,
  status,
  counts,
}: Readonly<SavedTripCardProps>) {
  const router = useRouter();
  const [isDeleting, startDelete] = useTransition();
  const [open, setOpen] = useState(false);

  // Persisted dates are UTC-noon by storage convention; format with UTC
  // accessors so the saved calendar day round-trips cleanly even in
  // UTC+13/UTC+14 (where local accessors would shift to next-day).
  const startStr = utcYmd(destination.startDate);
  const endStr = utcYmd(destination.endDate);
  const nights = daysBetween(startStr, endStr);

  const viewHref = buildTravelSearchUrl({
    latitude: destination.latitude,
    longitude: destination.longitude,
    startDate: startStr,
    endDate: endStr,
    label: destination.label,
    radiusKm: destination.radiusKm,
    timezone: destination.timezone,
  });

  const handleDelete = () => {
    startDelete(async () => {
      const result = await deleteTravelSearch(id);
      if ("success" in result && result.success) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  // Safe: `status` is typed as the SavedTripStatus union, not arbitrary
  // string. Codacy's "Generic Object Injection Sink" pattern-matches any
  // dynamic bracket access without checking the index type.
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
            <Link
              href={viewHref}
              onClick={() => {
                const daysSinceCreated = Math.max(
                  0,
                  Math.round(
                    (Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000),
                  ),
                );
                capture("travel_saved_search_viewed", {
                  searchId: id,
                  daysSinceCreated,
                });
                // Update lastViewedAt so the dashboard's recency sort
                // picks this trip up. Don't await — let the navigation
                // start immediately; the server action is a single
                // column update with no UI dependency.
                viewTravelSearch(id).catch((err) => {
                  console.error("[travel] viewTravelSearch failed", err);
                });
              }}
            >
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
                <AlertDialogDescription asChild>
                  <div className="space-y-3">
                    <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-3">
                      <div className="font-display text-base font-medium tracking-tight text-foreground">
                        {destination.label}
                      </div>
                      <div className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        {formatDateCompact(startStr, { withWeekday: true })}
                        {" → "}
                        {formatDateCompact(endStr, { withWeekday: true })}
                        {" · "}
                        {destination.radiusKm} km
                      </div>
                    </div>
                    <p>
                      Removes this trip from your saved list. The events
                      themselves stay on HashTracks — you can search for
                      them again any time.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeleting ? "Deleting…" : "Delete trip"}
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

