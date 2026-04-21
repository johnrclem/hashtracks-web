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
import { formatDateCompact, daysBetween, cityToIata } from "@/lib/travel/format";
import { buildTravelSearchUrl, utcYmd } from "@/lib/travel/url";
import { capture } from "@/lib/analytics";
import { deleteTravelSearch, viewTravelSearch } from "@/app/travel/actions";

/** Status of a saved trip relative to today. Shared with /travel/saved page. */
export type SavedTripStatus = "soon" | "active";

/** Per-leg shape mirroring SavedSearchSummaryDestination. */
export interface SavedTripLeg {
  label: string;
  latitude: number;
  longitude: number;
  timezone: string | null;
  radiusKm: number;
  startDate: Date;
  endDate: Date;
}

interface SavedTripCardProps {
  id: string;
  createdAt: Date;
  /**
   * All legs of the trip, position-ordered. Single-element for
   * single-destination trips (card renders today's layout unchanged);
   * 2–3 elements for multi-stop trips (route-stamp header + per-leg list).
   */
  destinations: SavedTripLeg[];
  status: SavedTripStatus;
  /** When non-null, render live aggregate counts across all legs. Null = search failed. */
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
  destinations,
  status,
  counts,
}: Readonly<SavedTripCardProps>) {
  const router = useRouter();
  const [isDeleting, startDelete] = useTransition();
  const [open, setOpen] = useState(false);

  if (destinations.length === 0) return null; // defensive — PR 1 guards this

  const isMultiStop = destinations.length > 1;
  const firstLeg = destinations[0];
  const lastLeg = destinations[destinations.length - 1];

  // Trip-level window spans from earliest leg start to latest leg end.
  const tripStartStr = utcYmd(firstLeg.startDate);
  const tripEndStr = utcYmd(lastLeg.endDate);
  const totalNights = daysBetween(tripStartStr, tripEndStr);

  // Multi-stop trips route through `?savedTripId=` (PR 3c); single-stop
  // keeps the stateless URL shape. For PR 3a the stateless URL still
  // works for multi-stop reads because we encode the first leg — opening
  // the card surfaces leg 01's results, which is the same visible trip
  // the user sees today on single-destination Travel Mode.
  const viewHref = isMultiStop
    ? `/travel?savedTripId=${encodeURIComponent(id)}`
    : buildTravelSearchUrl({
        latitude: firstLeg.latitude,
        longitude: firstLeg.longitude,
        startDate: tripStartStr,
        endDate: tripEndStr,
        label: firstLeg.label,
        radiusKm: firstLeg.radiusKm,
        timezone: firstLeg.timezone,
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

  const meta = STATUS_META[status];

  return (
    <article
      className="
        group relative overflow-hidden rounded-xl border border-border
        bg-card transition-all duration-200
        hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-lg
      "
    >
      <div className="h-1 bg-gradient-to-r from-emerald-500 via-sky-500 to-emerald-500" />

      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {isMultiStop ? (
              <MultiStopHeader destinations={destinations} />
            ) : (
              <h3 className="truncate font-display text-xl font-medium tracking-tight">
                {firstLeg.label}
              </h3>
            )}

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              <span>{formatDateCompact(tripStartStr, { withWeekday: true })}</span>
              <span>→</span>
              <span>{formatDateCompact(tripEndStr, { withWeekday: true })}</span>
              <span>·</span>
              <span>
                {totalNights} night{totalNights !== 1 ? "s" : ""}
              </span>
              {isMultiStop && (
                <>
                  <span>·</span>
                  <span>{destinations.length} legs</span>
                </>
              )}
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

        {/* Per-leg list — rendered only when multi-stop. Matches Mock 04. */}
        {isMultiStop && (
          <ol className="space-y-1 border-t border-dashed border-border/60 pt-3">
            {destinations.map((leg, i) => {
              const legStart = utcYmd(leg.startDate);
              const legEnd = utcYmd(leg.endDate);
              return (
                <li
                  key={`${i}-${leg.label}`}
                  className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3"
                >
                  <span className="inline-flex items-center justify-center rounded-sm border-[1.5px] border-muted-foreground/60 px-1.5 py-[1px] font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-mono text-sm font-semibold tracking-wider">
                    {cityToIata(leg.label)}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatDateCompact(legStart)}–{formatDateCompact(legEnd).replace(/^[A-Z][a-z]+ /, "")}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {leg.radiusKm} km
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {/* Live counts — aggregate across legs for multi-stop */}
        {counts && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <CountPill count={counts.confirmed} label="confirmed" dotClass="bg-emerald-500" />
            <CountPill count={counts.likely} label="likely" dotClass="bg-sky-500" />
            {counts.possible > 0 && (
              <CountPill count={counts.possible} label="possible" dotClass="bg-zinc-400" />
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
                  Math.round((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000)),
                );
                capture("travel_saved_search_viewed", {
                  searchId: id,
                  daysSinceCreated,
                  legCount: destinations.length,
                });
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
                        {isMultiStop
                          ? destinations.map((d) => d.label.split(",")[0]?.trim() ?? d.label).join(" → ")
                          : firstLeg.label}
                      </div>
                      <div className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        {formatDateCompact(tripStartStr, { withWeekday: true })}
                        {" → "}
                        {formatDateCompact(tripEndStr, { withWeekday: true })}
                        {" · "}
                        {isMultiStop
                          ? `${destinations.length} legs`
                          : `${firstLeg.radiusKm} km`}
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

/**
 * Multi-stop boarding-pass header: ITINERARY margin label, the route
 * stamp (LHR → CDG → BER) in the display font, and a city subhead
 * (LONDON · PARIS · BERLIN). Matches Mock 04 from the frontend-design
 * round.
 */
function MultiStopHeader({ destinations }: { destinations: SavedTripLeg[] }) {
  const iataCodes = destinations.map((d) => cityToIata(d.label));
  const cityNames = destinations.map((d) => {
    const first = d.label.split(",")[0]?.trim() ?? d.label;
    return first.toUpperCase();
  });

  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-red-600 dark:text-red-400">
        ◆ Itinerary
      </p>
      <h3 className="mt-1 truncate font-display text-xl font-medium tracking-tight tabular-nums sm:text-2xl">
        {iataCodes.map((code, i) => (
          <span key={i}>
            {i > 0 && (
              <span className="px-1.5 text-muted-foreground/50" aria-hidden="true">
                →
              </span>
            )}
            {code}
          </span>
        ))}
      </h3>
      <p className="mt-0.5 truncate font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {cityNames.join(" · ")}
      </p>
    </div>
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
