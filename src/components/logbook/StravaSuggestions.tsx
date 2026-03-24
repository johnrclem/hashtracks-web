"use client";

import { useState, useEffect, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { RegionBadge } from "@/components/hareline/RegionBadge";
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
  formatRelativeTime,
} from "@/lib/format";
import { buildStravaUrl } from "@/lib/strava/url";
import { RefreshCw } from "lucide-react";
import { StravaBackfillWizard } from "@/components/logbook/StravaBackfillWizard";

const HIDE_KEY = "hashtracks:strava-nudge-hidden";
const SKIP_KEY = "hashtracks:strava-skipped-ids";
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
  lastSyncAt,
}: Readonly<{
  stravaConnected: boolean;
  lastSyncAt?: string;
}>) {
  const [suggestions, setSuggestions] = useState<StravaSuggestion[]>([]);
  const [linkMatches, setLinkMatches] = useState<UnmatchedStravaMatch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [showAllLinks, setShowAllLinks] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Load skipped IDs from localStorage on mount
  useEffect(() => {
    try {
      const stored = globalThis.window?.localStorage.getItem(SKIP_KEY);
      if (stored) setSkippedIds(new Set(JSON.parse(stored)));
    } catch { /* ignore corrupt data */ }
  }, []);

  const linkGroups = useMemo(() => buildLinkGroups(linkMatches), [linkMatches]);

  const filteredSuggestions = useMemo(
    () => suggestions.filter((s) => !skippedIds.has(s.stravaActivityDbId)),
    [suggestions, skippedIds],
  );

  const totalCount = filteredSuggestions.length + linkGroups.length;

  useEffect(() => {
    if (!stravaConnected) return;
    if (
      typeof globalThis.window !== "undefined" &&
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

  function removeSuggestion(activityDbId: string) {
    setSuggestions((prev) =>
      prev.filter((s) => s.stravaActivityDbId !== activityDbId),
    );
  }

  function removeLinkMatch(key: string, field: "attendanceId" | "stravaActivityDbId") {
    setLinkMatches((prev) => prev.filter((m) => m[field] !== key));
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
      removeSuggestion(suggestion.stravaActivityDbId);
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
      removeSuggestion(stravaActivityDbId);
    });
  }

  function handleSkipSuggestion(stravaActivityDbId: string) {
    setSkippedIds((prev) => {
      const next = new Set(prev).add(stravaActivityDbId);
      try { globalThis.window?.localStorage.setItem(SKIP_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  function handleDismissAllSuggestions() {
    startTransition(async () => {
      const ids = filteredSuggestions.map((s) => s.stravaActivityDbId);
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
      removeLinkMatch(group.attendanceId, "attendanceId");
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
      removeLinkMatch(stravaActivityDbId, "stravaActivityDbId");
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
          {totalCount === 1 ? "match" : "matches"} for your recent activities
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
    ? filteredSuggestions
    : filteredSuggestions.slice(0, SUGGESTION_CAP);
  const visibleLinks = showAllLinks
    ? linkGroups
    : linkGroups.slice(0, LINK_CAP);

  return (
    <div className="space-y-4">
      {/* Section A header — always visible when expanded */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Strava Matches</h3>
            <span className="rounded-full bg-strava/10 px-2 py-0.5 text-[10px] font-semibold text-strava">
              {filteredSuggestions.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {lastSyncAt && (
              <span className="text-[11px] text-muted-foreground font-mono">
                Synced {formatRelativeTime(lastSyncAt)}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs font-mono border-strava/40 text-strava hover:bg-strava/5"
              onClick={handleSyncNow}
              disabled={isPending}
            >
              <RefreshCw size={12} className={isPending ? "animate-spin" : ""} />
              Sync
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

        <p className="text-xs text-muted-foreground -mt-1">
          Hash events that match your recent Strava activities
        </p>

        {/* Suggestion cards — only when there are matches */}
        {filteredSuggestions.length > 0 && (
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
                onSkip={() => handleSkipSuggestion(s.stravaActivityDbId)}
              />
            ))}
          </div>
        )}

        {!showAllSuggestions && filteredSuggestions.length > SUGGESTION_CAP && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => setShowAllSuggestions(true)}
          >
            Show all {filteredSuggestions.length} suggestions
          </Button>
        )}
      </div>

      {/* Section B: "Link Strava to check-ins" */}
      {linkGroups.length > 0 && (
        <>
          <div className="border-t" />
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Link Strava to check-ins</h3>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                  {linkGroups.length}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Attach Strava data to runs you&apos;ve already logged
              </p>
            </div>

            <div className="space-y-2">
              {visibleLinks.map((g) => (
                <LinkCard
                  key={g.attendanceId}
                  match={g.match}
                  isPending={isPending}
                  onLink={() => handleLink(g)}
                  onDismiss={() => handleDismissLink(g.match.stravaActivityDbId)}
                />
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
      </div>

      <StravaBackfillWizard
        open={showBackfill}
        onOpenChange={setShowBackfill}
      />
    </div>
  );
}

// ── Shared sub-components ──

function EventInfoLine({ eventId, kennelShortName, kennelFullName, kennelRegion, eventRunNumber, eventDate }: Readonly<{
  eventId: string;
  kennelShortName: string;
  kennelFullName: string;
  kennelRegion?: string | null;
  eventRunNumber?: number | null;
  eventDate: string;
}>) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={`/hareline/${eventId}`}
            className="font-semibold text-sm text-blue-500 hover:underline"
          >
            {kennelShortName}
          </a>
        </TooltipTrigger>
        <TooltipContent>{kennelFullName}</TooltipContent>
      </Tooltip>
      {kennelRegion && <RegionBadge region={kennelRegion} size="sm" />}
      <span className="text-xs text-muted-foreground font-mono">
        {eventRunNumber != null && `#${eventRunNumber} \u00B7 `}
        {formatDateShort(eventDate + "T12:00:00Z")}
      </span>
    </div>
  );
}

function StravaActivityLine({ stravaActivityId, activityName, distanceMeters, movingTimeSecs, timeLocal, city }: Readonly<{
  stravaActivityId: string;
  activityName: string;
  distanceMeters: number;
  movingTimeSecs: number;
  timeLocal?: string | null;
  city?: string | null;
}>) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="text-strava text-[10px]">{"\u2B21"}</span>
      <a
        href={buildStravaUrl(stravaActivityId)}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-strava hover:underline"
      >
        {activityName}
      </a>
      <span>&middot;</span>
      <span className="font-mono text-[11px]">
        {formatDistance(distanceMeters)}
        {movingTimeSecs > 0 && ` \u00B7 ${formatDuration(movingTimeSecs)}`}
        {timeLocal && ` \u00B7 ${formatTime(timeLocal)}`}
        {city && ` \u00B7 ${city}`}
      </span>
    </div>
  );
}

// ── Suggestion Card (Section A) — Event-first layout ──

function SuggestionCard({
  suggestion: s,
  isPending,
  onCheckIn,
  onDismiss,
  onSkip,
}: Readonly<{
  suggestion: StravaSuggestion;
  isPending: boolean;
  onCheckIn: () => void;
  onDismiss: () => void;
  onSkip: () => void;
}>) {
  const reasons = s.matchReasons ?? [];

  return (
    <div className="flex gap-3 rounded-lg border border-l-[3px] border-l-strava overflow-hidden px-3 py-2.5">
      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Line 1: Primary event info */}
        <EventInfoLine
          eventId={s.eventId}
          kennelShortName={s.kennelShortName}
          kennelFullName={s.kennelFullName}
          kennelRegion={s.kennelRegion}
          eventRunNumber={s.eventRunNumber}
          eventDate={s.eventDate}
        />

        {/* Line 2: Match reasons */}
        {reasons.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {reasons.map((reason) => (
              <span
                key={reason}
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                  reason.startsWith("Same") || reason.startsWith("Within")
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {reason}
              </span>
            ))}
          </div>
        )}

        {/* Line 3: Secondary Strava activity info */}
        <StravaActivityLine
          stravaActivityId={s.stravaActivityId}
          activityName={s.activityName}
          distanceMeters={s.distanceMeters}
          movingTimeSecs={s.movingTimeSecs}
          timeLocal={s.timeLocal}
          city={s.city}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1 items-end shrink-0">
        <Button
          size="sm"
          className="bg-emerald-500 hover:bg-emerald-600 text-white h-7 text-xs font-semibold"
          onClick={onCheckIn}
          disabled={isPending}
        >
          I Was There
        </Button>
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
          disabled={isPending}
        >
          Not a Hash
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground"
              onClick={onSkip}
            >
              Skip
            </button>
          </TooltipTrigger>
          <TooltipContent>Hide for now — won&apos;t permanently dismiss</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

// ── Link Card (Section B) — Attach Strava to existing check-ins ──

function LinkCard({
  match: m,
  isPending,
  onLink,
  onDismiss,
}: Readonly<{
  match: UnmatchedStravaMatch;
  isPending: boolean;
  onLink: () => void;
  onDismiss: () => void;
}>) {
  return (
    <div className="flex gap-3 rounded-lg border border-l-[3px] border-l-emerald-500 overflow-hidden px-3 py-2.5">
      <div className="flex-1 min-w-0 space-y-1">
        {/* Line 1: Event info */}
        <EventInfoLine
          eventId={m.eventId}
          kennelShortName={m.kennelShortName}
          kennelFullName={m.kennelFullName}
          kennelRegion={m.kennelRegion}
          eventRunNumber={m.eventRunNumber}
          eventDate={m.eventDate}
        />
        {/* Line 2: Strava activity */}
        <StravaActivityLine
          stravaActivityId={m.stravaActivityId}
          activityName={m.activityName}
          distanceMeters={m.distanceMeters}
          movingTimeSecs={m.stravaMovingTimeSecs}
          timeLocal={m.stravaTimeLocal}
          city={m.stravaCity}
        />
      </div>
      {/* Actions */}
      <div className="flex flex-col gap-1 items-end shrink-0">
        <Button size="sm" className="h-7 text-xs font-semibold" onClick={onLink} disabled={isPending}>
          Link
        </Button>
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
          disabled={isPending}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
