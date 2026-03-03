import {
  formatDistance,
  formatDuration,
  formatSportType,
  formatTime,
} from "@/lib/format";
import type { StravaActivityDisplay } from "@/lib/strava/types";

/**
 * Renders two-line Strava activity summary: name + distance/duration on line 1,
 * sport type + time + city on line 2. Used by EditAttendanceDialog and StravaNudgeBanner.
 */
export function StravaActivitySummary({ activity }: Readonly<{ activity: StravaActivityDisplay }>) {
  return (
    <>
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">
          {activity.name}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDistance(activity.distanceMeters)}
          {activity.movingTimeSecs > 0 && ` · ${formatDuration(activity.movingTimeSecs)}`}
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{formatSportType(activity.sportType)}</span>
        {activity.timeLocal && (
          <>
            <span aria-hidden="true">&middot;</span>
            <span>{formatTime(activity.timeLocal)}</span>
          </>
        )}
        {activity.city && (
          <>
            <span aria-hidden="true">&middot;</span>
            <span>{activity.city}</span>
          </>
        )}
      </span>
    </>
  );
}
