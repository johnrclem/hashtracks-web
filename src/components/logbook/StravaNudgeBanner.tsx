"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getUnmatchedStravaActivities,
  attachStravaActivity,
  dismissStravaMatch,
} from "@/app/strava/actions";
import type { UnmatchedStravaMatch } from "@/app/strava/actions";

const HIDE_KEY = "hashtracks:strava-nudge-hidden";

function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  return `${miles.toFixed(1)} mi`;
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function StravaNudgeBanner({ stravaConnected }: { stravaConnected: boolean }) {
  const [matches, setMatches] = useState<UnmatchedStravaMatch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!stravaConnected) return;
    // Check localStorage for global hide
    if (typeof window !== "undefined" && localStorage.getItem(HIDE_KEY) === "true") {
      setHidden(true);
      setLoaded(true);
      return;
    }
    getUnmatchedStravaActivities().then((result) => {
      if (result.success) setMatches(result.matches);
      setLoaded(true);
    });
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

  function handleHideAll() {
    localStorage.setItem(HIDE_KEY, "true");
    setHidden(true);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Strava Matches ({matches.length})
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-muted-foreground"
          onClick={handleHideAll}
        >
          Hide
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        We found Strava activities that match your recent check-ins. Link them to your logbook.
      </p>
      <div className="space-y-2">
        {matches.map((match) => (
          <div
            key={`${match.stravaActivityDbId}-${match.attendanceId}`}
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="shrink-0 font-medium text-muted-foreground">
                  {match.kennelShortName}
                </span>
                <span className="min-w-0 truncate font-medium">
                  {match.activityName}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDistance(match.distanceMeters)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDate(match.eventDate)}
              </div>
            </div>
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
        ))}
      </div>
    </div>
  );
}
