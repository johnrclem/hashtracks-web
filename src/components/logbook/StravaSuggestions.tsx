"use client";

import { useState, useEffect, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getStravaEventSuggestions,
  getUnmatchedStravaActivities,
  attachStravaActivity,
  dismissStravaMatch,
  dismissAllStravaMatches,
  triggerStravaSync,
} from "@/app/strava/actions";
import type {
  StravaSuggestion,
  UnmatchedStravaMatch,
} from "@/app/strava/actions";
import { checkInWithStrava } from "@/app/logbook/actions";
import {
  formatDistance,
  formatDateShort,
  formatDuration,
  formatTime,
} from "@/lib/format";
import { RefreshCw } from "lucide-react";
import { StravaBackfillWizard } from "@/components/logbook/StravaBackfillWizard";

const HIDE_KEY = "hashtracks:strava-nudge-hidden";
const SUGGESTION_CAP = 5;
const LINK_CAP = 5;

// ── Link match grouping (same approach as StravaNudgeBanner) ──

interface LinkGroup {
  attendanceId: string;
  kennelShortName: string;
  eventDate: string;
  match: UnmatchedStravaMatch;
}

function buildLinkGroups(matches: UnmatchedStravaMatch[]): LinkGroup[] {
  // Deduplicate by attendanceId — take the first match per attendance
  const seen = new Set<string>();
  const groups: LinkGroup[] = [];
  for (const m of matches) {
    if (seen.has(m.attendanceId)) continue;
    seen.add(m.attendanceId);
    groups.push({
      attendanceId: m.attendanceId,
      kennelShortName: m.kennelShortName,
      eventDate: m.eventDate,
      match: m,
    });
  }
  return groups;
}

export function StravaSuggestions({
  stravaConnected,
}: {
  stravaConnected: boolean;
}) {
  const [suggestions, setSuggestions] = useState<StravaSuggestion[]>([]);
  const [linkMatches, setLinkMatches] = useState<UnmatchedStravaMatch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [showAllLinks, setShowAllLinks] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const linkGroups = useMemo(() => buildLinkGroups(linkMatches), [linkMatches]);

  const totalCount = suggestions.length + linkGroups.length;

  useEffect(() => {
    if (!stravaConnected) return;
    if (
      typeof window !== "undefined" &&
      localStorage.getItem(HIDE_KEY) === "true"
    ) {
      setHidden(true);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    async function fetchData() {
      try {
        const [suggestionsResult, matchesResult] = await Promise.all([
          getStravaEventSuggestions(),
          getUnmatchedStravaActivities(),
        ]);
        if (cancelled) return;
        if (suggestionsResult.success)
          setSuggestions(suggestionsResult.suggestions);
        if (matchesResult.success) setLinkMatches(matchesResult.matches);
      } catch (err) {
        console.error("Failed to fetch Strava data:", err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [stravaConnected]);

  if (!stravaConnected || !loaded || hidden || totalCount === 0) return null;

  function handleHide() {
    localStorage.setItem(HIDE_KEY, "true");
    setHidden(true);
  }

  function handleCheckIn(suggestion: StravaSuggestion) {
    startTransition(async () => {
      const result = await checkInWithStrava(
        suggestion.eventId,
        suggestion.stravaActivityDbId,
      );
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Checked in!");
      setSuggestions((prev) =>
        prev.filter(
          (s) => s.stravaActivityDbId !== suggestion.stravaActivityDbId,
        ),
      );
      router.refresh();
    });
  }

  function handleDismissSuggestion(stravaActivityDbId: string) {
    startTransition(async () => {
      const result = await dismissStravaMatch(stravaActivityDbId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setSuggestions((prev) =>
        prev.filter((s) => s.stravaActivityDbId !== stravaActivityDbId),
      );
    });
  }

  function handleDismissAllSuggestions() {
    startTransition(async () => {
      const ids = suggestions.map((s) => s.stravaActivityDbId);
      const result = await dismissAllStravaMatches(ids);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setSuggestions([]);
      toast.success("All suggestions dismissed");
    });
  }

  function handleLink(group: LinkGroup) {
    startTransition(async () => {
      const result = await attachStravaActivity(
        group.match.stravaActivityDbId,
        group.attendanceId,
      );
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Strava activity linked");
      setLinkMatches((prev) =>
        prev.filter((m) => m.attendanceId !== group.attendanceId),
      );
      router.refresh();
    });
  }

  function handleDismissLink(stravaActivityDbId: string) {
    startTransition(async () => {
      const result = await dismissStravaMatch(stravaActivityDbId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setLinkMatches((prev) =>
        prev.filter((m) => m.stravaActivityDbId !== stravaActivityDbId),
      );
    });
  }

  function handleSyncNow() {
    startTransition(async () => {
      const result = await triggerStravaSync();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Synced ${result.syncedCount} activities`);
      // Re-fetch both data sources
      const [suggestionsResult, matchesResult] = await Promise.all([
        getStravaEventSuggestions(),
        getUnmatchedStravaActivities(),
      ]);
      if (suggestionsResult.success)
        setSuggestions(suggestionsResult.suggestions);
      if (matchesResult.success) setLinkMatches(matchesResult.matches);
      router.refresh();
    });
  }

  // ── Collapsed state ──
  if (!expanded) {
    return (
      <div className="flex items-center justify-between rounded-lg border px-4 py-3">
        <p className="text-sm">
          <span
            className="mr-2 inline-block h-2 w-2 rounded-full bg-strava animate-pulse"
            aria-hidden="true"
          />
          <span className="font-medium">{totalCount}</span> Strava{" "}
          {totalCount === 1 ? "activity" : "activities"} may be hash runs
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
            onClick={handleHide}
          >
            Hide
          </Button>
        </div>
      </div>
    );
  }

  // ── Expanded state ──
  const visibleSuggestions = showAllSuggestions
    ? suggestions
    : suggestions.slice(0, SUGGESTION_CAP);
  const visibleLinks = showAllLinks
    ? linkGroups
    : linkGroups.slice(0, LINK_CAP);

  return (
    <div className="space-y-4">
      {/* Section A: "Were you there?" — event suggestions */}
      {suggestions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Were you there?</h3>
              <span className="rounded-full bg-strava/10 px-2 py-0.5 text-[10px] font-semibold text-strava">
                {suggestions.length} new
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-muted-foreground"
                onClick={handleDismissAllSuggestions}
                disabled={isPending}
              >
                Dismiss All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-muted-foreground"
                onClick={handleHide}
              >
                Hide
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {visibleSuggestions.map((s) => (
              <SuggestionCard
                key={s.stravaActivityDbId}
                suggestion={s}
                isPending={isPending}
                onCheckIn={() => handleCheckIn(s)}
                onDismiss={() =>
                  handleDismissSuggestion(s.stravaActivityDbId)
                }
              />
            ))}
          </div>

          {!showAllSuggestions && suggestions.length > SUGGESTION_CAP && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => setShowAllSuggestions(true)}
            >
              Show all {suggestions.length} suggestions
            </Button>
          )}
        </div>
      )}

      {/* Section B: "Link Strava to check-ins" */}
      {linkGroups.length > 0 && (
        <>
          {suggestions.length > 0 && <div className="border-t my-4" />}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">
              Link Strava to check-ins ({linkGroups.length})
            </h3>

            <div className="space-y-2">
              {visibleLinks.map((g) => (
                <div
                  key={g.attendanceId}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <span className="shrink-0 font-semibold text-muted-foreground">
                      {g.kennelShortName}
                    </span>
                    <span className="min-w-0 truncate font-medium">
                      {g.match.activityName}
                    </span>
                    <span className="shrink-0 text-xs font-mono text-muted-foreground">
                      {formatDistance(g.match.distanceMeters)}
                    </span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-xs"
                      onClick={() => handleLink(g)}
                      disabled={isPending}
                    >
                      Link
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() =>
                        handleDismissLink(g.match.stravaActivityDbId)
                      }
                      disabled={isPending}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {!showAllLinks && linkGroups.length > LINK_CAP && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setShowAllLinks(true)}
              >
                Show all {linkGroups.length} matches
              </Button>
            )}
          </div>
        </>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          className="text-sm text-strava hover:underline"
          onClick={() => setShowBackfill(true)}
        >
          Review all Strava activities &rarr;
        </button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs font-mono"
          onClick={handleSyncNow}
          disabled={isPending}
        >
          <RefreshCw size={12} className={isPending ? "animate-spin" : ""} />
          Sync Now
        </Button>
      </div>

      <StravaBackfillWizard
        open={showBackfill}
        onOpenChange={setShowBackfill}
      />
    </div>
  );
}

// ── Suggestion Card (Section A) ──

function SuggestionCard({
  suggestion: s,
  isPending,
  onCheckIn,
  onDismiss,
}: {
  suggestion: StravaSuggestion;
  isPending: boolean;
  onCheckIn: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-lg border border-l-[3px] border-l-strava overflow-hidden">
      <div className="px-3 py-2.5 space-y-1.5">
        {/* Line 1: Activity name + stats */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-medium">
              {s.activityName}
            </span>
            <span className="shrink-0 text-xs font-mono text-muted-foreground">
              {formatDistance(s.distanceMeters)}
              {s.movingTimeSecs > 0 && (
                <> &middot; {formatDuration(s.movingTimeSecs)}</>
              )}
              {s.timeLocal && (
                <> &middot; {formatTime(s.timeLocal)}</>
              )}
            </span>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button
              size="sm"
              className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
              onClick={onCheckIn}
              disabled={isPending}
            >
              I Was There
            </Button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground px-1.5"
              onClick={onDismiss}
              disabled={isPending}
            >
              Not a Hash
            </button>
          </div>
        </div>

        {/* Line 2: Event match pill */}
        <div className="flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1 text-xs">
          <span aria-hidden="true" className="text-muted-foreground">
            &rarr;
          </span>
          <span className="font-semibold">{s.kennelShortName}</span>
          {s.eventRunNumber != null && (
            <span className="text-muted-foreground">
              #{s.eventRunNumber}
            </span>
          )}
          <span className="text-muted-foreground">&middot;</span>
          <span className="text-muted-foreground">
            {formatDateShort(s.eventDate + "T12:00:00Z")}
          </span>
          {s.eventLocationName && (
            <>
              <span className="text-muted-foreground">&middot;</span>
              <span className="max-w-[200px] truncate text-muted-foreground">
                {s.eventLocationName}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
