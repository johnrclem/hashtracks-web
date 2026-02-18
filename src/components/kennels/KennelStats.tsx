interface KennelStatsProps {
  totalEvents: number;
  oldestEventDate: string | null; // ISO string
  nextRunDate: string | null; // ISO string
}

export function KennelStats({
  totalEvents,
  oldestEventDate,
  nextRunDate,
}: KennelStatsProps) {
  if (totalEvents === 0) return null;

  return (
    <div className="rounded-lg border p-4">
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
        Kennel Stats
      </h2>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>
          <span className="font-medium">{totalEvents.toLocaleString()}</span>{" "}
          events
        </span>
        {oldestEventDate && (
          <span>
            Since{" "}
            <span className="font-medium">
              {new Date(oldestEventDate).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
                timeZone: "UTC",
              })}
            </span>
          </span>
        )}
        {nextRunDate && (
          <span>
            Next run:{" "}
            <span className="font-medium">
              {new Date(nextRunDate).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
