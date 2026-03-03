"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getUnmatchedStravaActivities,
  attachStravaActivity,
  dismissStravaMatch,
  dismissAllStravaMatches,
} from "@/app/strava/actions";
import { buildStravaUrl } from "@/lib/strava/client";
import type { UnmatchedStravaMatch } from "@/app/strava/actions";
import { formatTime, formatDateShort, formatDistance, formatDuration, formatSportType } from "@/lib/format";
import {
  ExternalLink,
  ChevronDown,
  ChevronRight,
  MapPin,
  Clock,
  Users,
} from "lucide-react";

const HIDE_KEY = "hashtracks:strava-nudge-hidden";
const VISIBLE_CAP = 5;

export function StravaNudgeBanner({ stravaConnected }: { stravaConnected: boolean }) {
  const [matches, setMatches] = useState<UnmatchedStravaMatch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function toggleCard(key: string) {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    if (!stravaConnected) return;
    // Check localStorage for global hide
    if (typeof window !== "undefined" && localStorage.getItem(HIDE_KEY) === "true") {
      setHidden(true);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    async function fetchMatches() {
      try {
        const result = await getUnmatchedStravaActivities();
        if (!cancelled && result.success) setMatches(result.matches);
      } catch (err) {
        console.error("Failed to fetch Strava matches:", err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    fetchMatches();
    return () => { cancelled = true; };
  }, [stravaConnected]);

  if (!stravaConnected || !loaded || hidden || matches.length === 0) return null;

  function handleLink(match: UnmatchedStravaMatch) {
    startTransition(async () => {
      const result = await attachStravaActivity(match.stravaActivityDbId, match.attendanceId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Strava activity linked");
      setMatches((prev) =>
        prev.filter((m) => m.stravaActivityDbId !== match.stravaActivityDbId),
      );
      router.refresh();
    });
  }

  function handleDismiss(stravaActivityDbId: string) {
    startTransition(async () => {
      const result = await dismissStravaMatch(stravaActivityDbId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setMatches((prev) =>
        prev.filter((m) => m.stravaActivityDbId !== stravaActivityDbId),
      );
    });
  }

  function handleDismissAll() {
    startTransition(async () => {
      const ids = [...new Set(matches.map((m) => m.stravaActivityDbId))];
      const result = await dismissAllStravaMatches(ids);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      if (result.dismissedCount < ids.length) {
        // Partial dismiss — re-fetch to get accurate state
        toast.success(`${result.dismissedCount} of ${ids.length} matches dismissed`);
        const refreshed = await getUnmatchedStravaActivities();
        if (refreshed.success) setMatches(refreshed.matches);
      } else {
        setMatches([]);
        toast.success("All matches dismissed");
      }
    });
  }

  function handleHideAll() {
    localStorage.setItem(HIDE_KEY, "true");
    setHidden(true);
  }

  // Collapsed state: compact banner
  if (!expanded) {
    return (
      <div className="flex items-center justify-between rounded-lg border px-4 py-3">
        <p className="text-sm">
          <span className="font-medium">{matches.length}</span>{" "}
          Strava {matches.length === 1 ? "activity" : "activities"} may match your runs
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setExpanded(true)}
          >
            Review
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={handleHideAll}
          >
            Hide
          </Button>
        </div>
      </div>
    );
  }

  // Expanded state: show matches (capped at VISIBLE_CAP unless showAll)
  const visibleMatches = showAll ? matches : matches.slice(0, VISIBLE_CAP);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Strava Matches ({matches.length})
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-muted-foreground"
            onClick={handleDismissAll}
            disabled={isPending}
          >
            Dismiss All
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-muted-foreground"
            onClick={handleHideAll}
          >
            Hide
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        We found Strava activities that match your recent check-ins. Link them to your logbook.
      </p>
      <div className="space-y-2">
        {visibleMatches.map((match) => {
          const cardKey = `${match.stravaActivityDbId}-${match.attendanceId}`;
          const isCardExpanded = expandedCards.has(cardKey);

          return (
            <div
              key={cardKey}
              className="rounded-lg border overflow-hidden"
            >
              {/* Compact header row */}
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                  onClick={() => toggleCard(cardKey)}
                  aria-expanded={isCardExpanded}
                  aria-label={`Show details for ${match.kennelShortName} match`}
                >
                  {isCardExpanded
                    ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                    : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                  }
                  <span className="shrink-0 font-medium text-muted-foreground">
                    {match.kennelShortName}
                  </span>
                  <span className="min-w-0 truncate font-medium">
                    {match.eventTitle || match.activityName}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDistance(match.distanceMeters)}
                  </span>
                </button>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs"
                    onClick={() => handleLink(match)}
                    disabled={isPending}
                  >
                    Link
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => handleDismiss(match.stravaActivityDbId)}
                    disabled={isPending}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>

              {/* Date line */}
              <div className="px-3 pb-2 pl-9 text-xs text-muted-foreground">
                {formatDateShort(match.eventDate)}
                {match.eventRunNumber != null && <> &middot; #{match.eventRunNumber}</>}
              </div>

              {/* Expandable detail section */}
              {isCardExpanded && (
                <div className="border-t bg-muted/30 px-3 py-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {/* Event details */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Event
                      </p>
                      <p className="text-sm font-medium">{match.kennelFullName}</p>
                      {match.eventTitle && (
                        <p className="text-sm">{match.eventTitle}</p>
                      )}
                      {match.eventStartTime && (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock size={12} />
                          {formatTime(match.eventStartTime)}
                        </p>
                      )}
                      {match.eventLocationName && (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin size={12} />
                          <span className="truncate">{match.eventLocationName}</span>
                        </p>
                      )}
                      {match.eventHaresText && (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Users size={12} />
                          Hares: {match.eventHaresText}
                        </p>
                      )}
                      <a
                        href={`/hareline/${match.eventId}`}
                        className="inline-block text-xs text-primary hover:underline mt-1"
                      >
                        View event details
                      </a>
                    </div>

                    {/* Strava activity details */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Strava Activity
                      </p>
                      <p className="text-sm font-medium">{match.activityName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatSportType(match.stravaSportType)}
                        {match.stravaTimeLocal && <> &middot; {formatTime(match.stravaTimeLocal)}</>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistance(match.distanceMeters)}
                        {match.stravaMovingTimeSecs > 0 && (
                          <> &middot; {formatDuration(match.stravaMovingTimeSecs)}</>
                        )}
                      </p>
                      <a
                        href={buildStravaUrl(match.stravaActivityId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-strava hover:underline mt-1"
                      >
                        <ExternalLink size={12} />
                        View in Strava
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!showAll && matches.length > VISIBLE_CAP && (
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => setShowAll(true)}
        >
          Show all {matches.length} matches
        </Button>
      )}
    </div>
  );
}
