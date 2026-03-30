"use client";

import { useState, useEffect, useTransition, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  getStravaBackfillActivities,
  dismissStravaMatch,
  dismissAllStravaMatches,
  undismissStravaMatch,
} from "@/app/strava/actions";
import type { BackfillActivity } from "@/app/strava/actions";
import { checkInWithStrava } from "@/app/logbook/actions";
import { formatDistance, formatDuration, formatDateShort } from "@/lib/format";
import { buildStravaUrl } from "@/lib/strava/url";
import { toast } from "sonner";
import { ExternalLink, Loader2, Check } from "lucide-react";

type FilterTab = "all" | "unreviewed" | "linked" | "dismissed";

/** Update a single activity by ID within the activities list. */
function updateActivity(
  prev: BackfillActivity[],
  id: string,
  patch: Partial<BackfillActivity>,
): BackfillActivity[] {
  return prev.map((a) => (a.id === id ? { ...a, ...patch } : a));
}

/** Update multiple activities by ID within the activities list. */
function updateActivitiesByIds(
  prev: BackfillActivity[],
  ids: string[],
  patch: Partial<BackfillActivity>,
): BackfillActivity[] {
  return prev.map((a) => (ids.includes(a.id) ? { ...a, ...patch } : a));
}

/** Resolve the description text for the dialog header. */
function getDescriptionText(loaded: boolean, total: number): string {
  if (!loaded) return "Loading activities...";
  return `${total} ${total === 1 ? "activity" : "activities"} from the last 90 days`;
}

export function StravaBackfillWizard({
  open,
  onOpenChange,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const [activities, setActivities] = useState<BackfillActivity[]>([]);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Fetch activities when dialog opens
  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    let cancelled = false;
    async function load() {
      try {
        const result = await getStravaBackfillActivities();
        if (cancelled) return;
        if (result.success) {
          setActivities(result.activities);
        } else {
          toast.error(result.error);
        }
      } catch {
        if (!cancelled) toast.error("Failed to load activities");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Filter logic
  const filtered = useMemo(() => {
    switch (filter) {
      case "unreviewed":
        return activities.filter((a) => !a.isMatched && !a.isDismissed);
      case "linked":
        return activities.filter((a) => a.isMatched);
      case "dismissed":
        return activities.filter((a) => a.isDismissed);
      default:
        return activities;
    }
  }, [activities, filter]);

  // Counts
  const counts = useMemo(() => {
    let unreviewed = 0;
    let linked = 0;
    let dismissed = 0;
    for (const a of activities) {
      if (a.isMatched) linked++;
      else if (a.isDismissed) dismissed++;
      else unreviewed++;
    }
    return { all: activities.length, unreviewed, linked, dismissed };
  }, [activities]);

  // Progress
  const reviewed = counts.linked + counts.dismissed;
  const total = counts.all;
  const pct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  // ── Handlers ──

  const handleCheckIn = useCallback(
    (activity: BackfillActivity) => {
      if (!activity.candidateEvent) return;
      startTransition(async () => {
        const result = await checkInWithStrava(
          activity.candidateEvent!.eventId,
          activity.id,
        );
        if (result.success) {
          setActivities((prev) =>
            updateActivity(prev, activity.id, { isMatched: true }),
          );
          toast.success("Checked in!");
          router.refresh();
        } else {
          toast.error(result.error);
        }
      });
    },
    [router, startTransition],
  );

  const handleNotAHash = useCallback(
    (activityId: string) => {
      startTransition(async () => {
        const result = await dismissStravaMatch(activityId);
        if (result.success) {
          setActivities((prev) =>
            updateActivity(prev, activityId, { isDismissed: true }),
          );
        } else {
          toast.error(result.error);
        }
      });
    },
    [startTransition],
  );

  const handleUndo = useCallback(
    (activityId: string) => {
      startTransition(async () => {
        const result = await undismissStravaMatch(activityId);
        if (result.success) {
          setActivities((prev) =>
            updateActivity(prev, activityId, { isDismissed: false }),
          );
        } else {
          toast.error(result.error);
        }
      });
    },
    [startTransition],
  );

  const handleDismissAllUnreviewed = useCallback(() => {
    const unreviewedIds = activities
      .filter((a) => !a.isMatched && !a.isDismissed)
      .map((a) => a.id);
    if (unreviewedIds.length === 0) return;
    startTransition(async () => {
      const result = await dismissAllStravaMatches(unreviewedIds);
      if (result.success) {
        setActivities((prev) =>
          updateActivitiesByIds(prev, unreviewedIds, { isDismissed: true }),
        );
        toast.success(`Dismissed ${result.dismissedCount} activities`);
      } else {
        toast.error(result.error);
      }
    });
  }, [activities, startTransition]);

  const handleDone = useCallback(() => {
    onOpenChange(false);
    router.refresh();
    if (reviewed > 0) {
      toast.success(`${reviewed} of ${total} activities reviewed`);
    }
  }, [onOpenChange, router, reviewed, total]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] flex flex-col p-0">
        {/* Header */}
        <div className="px-6 pt-6 pb-0">
          <DialogHeader>
            <DialogTitle>Review Strava Activities</DialogTitle>
            <DialogDescription>
              {getDescriptionText(loaded, total)}
            </DialogDescription>
          </DialogHeader>
        </div>

        {loaded && activities.length > 0 && (
          <>
            {/* Filter chips + progress */}
            <div className="px-6 space-y-3">
              {/* Filter chips */}
              <div className="flex gap-2 flex-wrap">
                <FilterChip
                  tab="all"
                  label="All"
                  count={counts.all}
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                />
                <FilterChip
                  tab="unreviewed"
                  label="Unreviewed"
                  count={counts.unreviewed}
                  active={filter === "unreviewed"}
                  onClick={() => setFilter("unreviewed")}
                />
                <FilterChip
                  tab="linked"
                  label="Linked"
                  count={counts.linked}
                  active={filter === "linked"}
                  onClick={() => setFilter("linked")}
                />
                <FilterChip
                  tab="dismissed"
                  label="Dismissed"
                  count={counts.dismissed}
                  active={filter === "dismissed"}
                  onClick={() => setFilter("dismissed")}
                />
              </div>

              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-muted-foreground">
                    {reviewed} of {total} reviewed
                  </span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">{pct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 dark:bg-emerald-400 transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Scrollable activity list */}
            <div className="min-h-0 flex-1 overflow-y-auto border-t mx-6 pt-2 space-y-1.5">
              {filtered.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No activities in this category.
                </div>
              ) : (
                filtered.map((a) => (
                  <ActivityRow
                    key={a.id}
                    activity={a}
                    isPending={isPending}
                    onCheckIn={() => handleCheckIn(a)}
                    onNotAHash={() => handleNotAHash(a.id)}
                    onUndo={() => handleUndo(a.id)}
                  />
                ))
              )}
            </div>
          </>
        )}

        {loaded && activities.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No Strava activities found in the last 90 days.
          </div>
        )}

        {!loaded && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Footer */}
        {loaded && activities.length > 0 && (
          <div className="flex items-center justify-between border-t px-6 py-3">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={handleDismissAllUnreviewed}
              disabled={isPending || counts.unreviewed === 0}
            >
              Dismiss all unreviewed
            </Button>
            <Button size="sm" onClick={handleDone}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Filter Chip ──

function FilterChip({
  tab: _tab,
  label,
  count,
  active,
  onClick,
}: Readonly<{
  tab: FilterTab;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground hover:bg-muted/80"
      }`}
    >
      {label} ({count})
    </button>
  );
}

// ── Activity Row ──

function ActivityRow({
  activity: a,
  isPending,
  onCheckIn,
  onNotAHash,
  onUndo,
}: Readonly<{
  activity: BackfillActivity;
  isPending: boolean;
  onCheckIn: () => void;
  onNotAHash: () => void;
  onUndo: () => void;
}>) {
  // Already linked
  if (a.isMatched) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 opacity-60">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <span className="shrink-0 text-xs font-mono text-muted-foreground">
            {formatDateShort(a.dateLocal + "T12:00:00Z")}
          </span>
          <span className="min-w-0 truncate font-medium">{a.name}</span>
          <span className="shrink-0 text-xs font-mono text-muted-foreground">
            {formatDistance(a.distanceMeters)}
          </span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
          <Check size={12} />
          Linked
        </span>
      </div>
    );
  }

  // Dismissed
  if (a.isDismissed) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 opacity-40">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm line-through">
          <span className="shrink-0 text-xs font-mono text-muted-foreground">
            {formatDateShort(a.dateLocal + "T12:00:00Z")}
          </span>
          <span className="min-w-0 truncate font-medium">{a.name}</span>
          <span className="shrink-0 text-xs font-mono text-muted-foreground">
            {formatDistance(a.distanceMeters)}
          </span>
        </div>
        <button
          type="button"
          className="shrink-0 text-xs text-blue-600 hover:underline dark:text-blue-400"
          onClick={onUndo}
          disabled={isPending}
        >
          Undo
        </button>
      </div>
    );
  }

  // Unreviewed with candidate event match (strava orange left border)
  if (a.candidateEvent) {
    return (
      <div className="rounded-lg border border-l-[3px] border-l-strava overflow-hidden">
        <div className="px-3 py-2.5 space-y-1.5">
          {/* Row 1: date + activity name (link) + distance/duration */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
              <span className="shrink-0 text-xs font-mono text-muted-foreground">
                {formatDateShort(a.dateLocal + "T12:00:00Z")}
              </span>
              <a
                href={buildStravaUrl(a.stravaActivityId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1 hover:underline"
              >
                <span className="truncate font-semibold">{a.name}</span>
                <ExternalLink
                  size={12}
                  className="shrink-0 text-muted-foreground"
                />
              </a>
              <span className="shrink-0 text-xs font-mono text-muted-foreground">
                {formatDistance(a.distanceMeters)}
                {a.movingTimeSecs > 0 && (
                  <> &middot; {formatDuration(a.movingTimeSecs)}</>
                )}
              </span>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Button
                size="sm"
                className="h-7 text-xs bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800 text-white"
                onClick={onCheckIn}
                disabled={isPending}
              >
                Check In
              </Button>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={onNotAHash}
                disabled={isPending}
              >
                Not a Hash
              </button>
            </div>
          </div>

          {/* Row 2: candidate event pill */}
          <div className="flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1 text-xs">
            <span aria-hidden="true" className="text-muted-foreground">
              &rarr;
            </span>
            <span className="font-semibold">
              {a.candidateEvent.kennelShortName}
            </span>
            {a.candidateEvent.eventRunNumber != null && (
              <span className="text-muted-foreground">
                #{a.candidateEvent.eventRunNumber}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Unreviewed, no candidate match
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        <span className="shrink-0 text-xs font-mono text-muted-foreground">
          {formatDateShort(a.dateLocal + "T12:00:00Z")}
        </span>
        <a
          href={buildStravaUrl(a.stravaActivityId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-0 items-center gap-1 hover:underline"
        >
          <span className="truncate font-medium">{a.name}</span>
          <ExternalLink
            size={12}
            className="shrink-0 text-muted-foreground"
          />
        </a>
        <span className="shrink-0 text-xs font-mono text-muted-foreground">
          {formatDistance(a.distanceMeters)}
          {a.movingTimeSecs > 0 && (
            <> &middot; {formatDuration(a.movingTimeSecs)}</>
          )}
        </span>
      </div>
      <button
        type="button"
        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        onClick={onNotAHash}
        disabled={isPending}
      >
        Not a Hash
      </button>
    </div>
  );
}
