"use client";

import { useState, useEffect, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getUnmatchedStravaActivities,
  attachStravaActivity,
  dismissStravaMatch,
  dismissAllStravaMatches,
} from "@/app/strava/actions";
import type { UnmatchedStravaMatch } from "@/app/strava/actions";
import { formatTime, formatDateShort, formatDistance, formatDuration, formatSportType } from "@/lib/format";
import { buildStravaUrl } from "@/lib/strava/url";
import { findBestMatchIndex } from "@/lib/strava/match-score";
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

// ── Grouping types ──

interface MatchGroupActivity {
  stravaActivityDbId: string;
  stravaActivityId: string;
  activityName: string;
  distanceMeters: number;
  stravaSportType: string;
  stravaTimeLocal: string | null;
  stravaMovingTimeSecs: number;
  stravaCity: string | null;
}

interface MatchGroup {
  attendanceId: string;
  kennelShortName: string;
  kennelFullName: string;
  eventDate: string;
  eventId: string;
  eventTitle: string | null;
  eventRunNumber: number | null;
  eventStartTime: string | null;
  eventLocationName: string | null;
  eventHaresText: string | null;
  activities: MatchGroupActivity[];
  bestActivityIndex: number;
}

function groupMatchesByEvent(matches: UnmatchedStravaMatch[]): MatchGroup[] {
  const map = new Map<string, MatchGroup>();
  for (const m of matches) {
    let group = map.get(m.attendanceId);
    if (!group) {
      group = {
        attendanceId: m.attendanceId,
        kennelShortName: m.kennelShortName,
        kennelFullName: m.kennelFullName,
        eventDate: m.eventDate,
        eventId: m.eventId,
        eventTitle: m.eventTitle,
        eventRunNumber: m.eventRunNumber,
        eventStartTime: m.eventStartTime,
        eventLocationName: m.eventLocationName,
        eventHaresText: m.eventHaresText,
        activities: [],
        bestActivityIndex: 0,
      };
      map.set(m.attendanceId, group);
    }
    group.activities.push({
      stravaActivityDbId: m.stravaActivityDbId,
      stravaActivityId: m.stravaActivityId,
      activityName: m.activityName,
      distanceMeters: m.distanceMeters,
      stravaSportType: m.stravaSportType,
      stravaTimeLocal: m.stravaTimeLocal,
      stravaMovingTimeSecs: m.stravaMovingTimeSecs,
      stravaCity: m.stravaCity,
    });
  }

  // Calculate best match index for each group
  const groups = Array.from(map.values());
  for (const group of groups) {
    group.bestActivityIndex = findBestMatchIndex(
      group.activities,
      group.kennelShortName,
      group.eventStartTime,
    );
  }
  return groups;
}

export function StravaNudgeBanner({ stravaConnected }: { stravaConnected: boolean }) {
  const [matches, setMatches] = useState<UnmatchedStravaMatch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [selectedActivity, setSelectedActivity] = useState<Map<string, number>>(new Map());
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const groups = useMemo(() => groupMatchesByEvent(matches), [matches]);

  function getSelectedIndex(group: MatchGroup): number {
    return selectedActivity.get(group.attendanceId) ?? group.bestActivityIndex;
  }

  function toggleCard(attendanceId: string) {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(attendanceId)) next.delete(attendanceId);
      else next.add(attendanceId);
      return next;
    });
  }

  function selectActivityInGroup(attendanceId: string, index: number) {
    setSelectedActivity((prev) => {
      const next = new Map(prev);
      next.set(attendanceId, index);
      return next;
    });
  }

  useEffect(() => {
    if (!stravaConnected) return;
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

  function handleLink(group: MatchGroup) {
    const idx = getSelectedIndex(group);
    const activity = group.activities[idx];
    startTransition(async () => {
      const result = await attachStravaActivity(activity.stravaActivityDbId, group.attendanceId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Strava activity linked");
      // Remove all matches for this attendance (entire group is linked)
      setMatches((prev) =>
        prev.filter((m) => m.attendanceId !== group.attendanceId),
      );
      setExpandedCards((prev) => {
        const next = new Set(prev);
        next.delete(group.attendanceId);
        return next;
      });
      router.refresh();
    });
  }

  function handleDismiss(group: MatchGroup) {
    const idx = getSelectedIndex(group);
    const activity = group.activities[idx];
    startTransition(async () => {
      const result = await dismissStravaMatch(activity.stravaActivityDbId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      // Remove this specific activity from matches
      setMatches((prev) =>
        prev.filter((m) => m.stravaActivityDbId !== activity.stravaActivityDbId),
      );
      // Reset selection if needed
      setSelectedActivity((prev) => {
        const next = new Map(prev);
        next.delete(group.attendanceId);
        return next;
      });
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
    const groupCount = groups.length;
    return (
      <div className="flex items-center justify-between rounded-lg border px-4 py-3">
        <p className="text-sm">
          <span className="font-medium">{groupCount}</span>{" "}
          Strava {groupCount === 1 ? "match" : "matches"} found for your check-ins
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

  // Expanded state: show grouped matches (capped at VISIBLE_CAP unless showAll)
  const visibleGroups = showAll ? groups : groups.slice(0, VISIBLE_CAP);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Strava Matches ({groups.length})
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
        {visibleGroups.map((group) => {
          const isCardExpanded = expandedCards.has(group.attendanceId);
          const selectedIdx = getSelectedIndex(group);
          const bestActivity = group.activities[selectedIdx];

          return (
            <div
              key={group.attendanceId}
              className="rounded-lg border overflow-hidden"
            >
              {/* Compact header row */}
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                  onClick={() => toggleCard(group.attendanceId)}
                  aria-expanded={isCardExpanded}
                  aria-label={`Show details for ${group.kennelShortName} match`}
                >
                  {isCardExpanded
                    ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                    : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                  }
                  <span className="shrink-0 font-medium text-muted-foreground">
                    {group.kennelShortName}
                  </span>
                  <span className="min-w-0 truncate font-medium">
                    {bestActivity.activityName}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDistance(bestActivity.distanceMeters)}
                  </span>
                </button>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs"
                    onClick={() => handleLink(group)}
                    disabled={isPending}
                  >
                    Link
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => handleDismiss(group)}
                    disabled={isPending}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>

              {/* Date line + "+N more" badge */}
              <div className="flex items-center gap-2 px-3 pb-2 pl-9 text-xs text-muted-foreground">
                <span>
                  {formatDateShort(group.eventDate)}
                  {group.eventRunNumber != null && <> &middot; #{group.eventRunNumber}</>}
                </span>
                {group.activities.length > 1 && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                    +{group.activities.length - 1} more
                  </span>
                )}
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
                      <p className="text-sm font-medium">{group.kennelFullName}</p>
                      {group.eventTitle && (
                        <p className="text-sm">{group.eventTitle}</p>
                      )}
                      {group.eventStartTime && (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock size={12} />
                          {formatTime(group.eventStartTime)}
                        </p>
                      )}
                      {group.eventLocationName && (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin size={12} />
                          <span className="truncate">{group.eventLocationName}</span>
                        </p>
                      )}
                      {group.eventHaresText && (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Users size={12} />
                          Hares: {group.eventHaresText}
                        </p>
                      )}
                      <a
                        href={`/hareline/${group.eventId}`}
                        className="inline-block text-xs text-primary hover:underline mt-1"
                      >
                        View event details
                      </a>
                    </div>

                    {/* Strava activities list */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {group.activities.length === 1 ? "Strava Activity" : "Strava Activities"}
                      </p>
                      <div className="space-y-1">
                        {group.activities.map((activity, actIdx) => {
                          const isSelected = actIdx === selectedIdx;
                          return (
                            <button
                              key={activity.stravaActivityDbId}
                              type="button"
                              className={`w-full rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors ${
                                isSelected
                                  ? "border-strava/40 bg-strava/5"
                                  : "border-transparent hover:bg-muted"
                              } ${group.activities.length === 1 ? "cursor-default" : ""}`}
                              onClick={() => {
                                if (group.activities.length > 1) {
                                  selectActivityInGroup(group.attendanceId, actIdx);
                                }
                              }}
                              aria-pressed={isSelected}
                            >
                              <span className="flex items-center gap-2">
                                {group.activities.length > 1 && (
                                  <span className={`mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full border-2 ${
                                    isSelected ? "border-strava bg-strava" : "border-muted-foreground/40"
                                  }`} />
                                )}
                                <span className="min-w-0 flex-1 truncate font-medium">
                                  {activity.activityName}
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {formatDistance(activity.distanceMeters)}
                                  {activity.stravaMovingTimeSecs > 0 && ` · ${formatDuration(activity.stravaMovingTimeSecs)}`}
                                </span>
                              </span>
                              <span className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                                <span>{formatSportType(activity.stravaSportType)}</span>
                                {activity.stravaTimeLocal && (
                                  <>
                                    <span aria-hidden="true">&middot;</span>
                                    <span>{formatTime(activity.stravaTimeLocal)}</span>
                                  </>
                                )}
                                {activity.stravaCity && (
                                  <>
                                    <span aria-hidden="true">&middot;</span>
                                    <span>{activity.stravaCity}</span>
                                  </>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {/* View in Strava link for selected activity */}
                      <a
                        href={buildStravaUrl(bestActivity.stravaActivityId)}
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
      {!showAll && groups.length > VISIBLE_CAP && (
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => setShowAll(true)}
        >
          Show all {groups.length} matches
        </Button>
      )}
    </div>
  );
}
