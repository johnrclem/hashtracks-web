"use client";

interface AlertContextDisplayProps {
  type: string;
  context: Record<string, unknown> | null;
  details: string | null;
}

export function AlertContextDisplay({
  type,
  context,
  details,
}: AlertContextDisplayProps) {
  // Fall back to plain text details if no structured context
  if (!context) {
    return details ? (
      <p className="text-xs text-muted-foreground whitespace-pre-wrap">
        {details}
      </p>
    ) : null;
  }

  switch (type) {
    case "EVENT_COUNT_ANOMALY":
      return <EventCountContext context={context} />;
    case "FIELD_FILL_DROP":
      return <FieldFillContext context={context} />;
    case "STRUCTURE_CHANGE":
      return <StructureChangeContext context={context} />;
    case "SCRAPE_FAILURE":
    case "CONSECUTIVE_FAILURES":
      return <ScrapeFailureContext context={context} />;
    case "SOURCE_KENNEL_MISMATCH":
      return <SourceKennelMismatchContext context={context} details={details} />;
    default:
      return details ? (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
          {details}
        </p>
      ) : null;
  }
}

function EventCountContext({ context }: { context: Record<string, unknown> }) {
  const current = context.currentCount as number;
  const baseline = context.baselineAvg as number;
  const drop = context.dropPercent as number;
  const window = context.baselineWindow as number;

  return (
    <div className="grid grid-cols-3 gap-3 text-xs mt-1">
      <div className="rounded-md bg-muted/50 p-2">
        <div className="text-muted-foreground">Baseline avg</div>
        <div className="text-sm font-semibold">{baseline}</div>
        <div className="text-muted-foreground">last {window} scrapes</div>
      </div>
      <div className="rounded-md bg-muted/50 p-2">
        <div className="text-muted-foreground">Current</div>
        <div className="text-sm font-semibold text-red-600">{current}</div>
      </div>
      <div className="rounded-md bg-muted/50 p-2">
        <div className="text-muted-foreground">Drop</div>
        <div className="text-sm font-semibold text-red-600">{drop}%</div>
      </div>
    </div>
  );
}

function FieldFillContext({ context }: { context: Record<string, unknown> }) {
  const field = context.field as string;
  const current = context.currentRate as number;
  const baseline = context.baselineAvg as number;

  return (
    <div className="flex items-center gap-3 text-xs mt-1">
      <span className="font-medium capitalize">{field}</span>
      <span className="text-muted-foreground">{baseline}%</span>
      <span className="text-red-600">→ {current}%</span>
      <span className="text-red-600 font-medium">
        (−{baseline - current}pp)
      </span>
    </div>
  );
}

function StructureChangeContext({
  context,
}: {
  context: Record<string, unknown>;
}) {
  const prev = (context.previousHash as string)?.slice(0, 16);
  const curr = (context.currentHash as string)?.slice(0, 16);
  const qualityImpacted = context.qualityImpacted as boolean | undefined;
  const prevEventCount = context.previousEventCount as number | undefined;
  const currEventCount = context.currentEventCount as number | undefined;
  const fillBaseline = context.fillRateBaseline as Record<string, number> | undefined;
  const fillCurrent = context.fillRateCurrent as Record<string, number> | undefined;

  // Legacy context (before quality enrichment) — fall back to hash-only display
  const hasQualityData = prevEventCount !== undefined;

  return (
    <div className="text-xs mt-1 space-y-2">
      {/* Impact badge */}
      {hasQualityData && (
        <div
          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
            qualityImpacted
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
              : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
          }`}
        >
          {qualityImpacted
            ? "Data quality may be affected"
            : "No impact on data quality"}
        </div>
      )}

      {/* Metrics comparison */}
      {hasQualityData && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md bg-muted/50 p-2">
            <div className="text-muted-foreground">Events</div>
            <div className="text-sm">
              <span className="text-muted-foreground">{prevEventCount}</span>
              <span className="mx-1">→</span>
              <span className="font-semibold">{currEventCount}</span>
            </div>
          </div>
          {fillBaseline && fillCurrent && (
            <div className="rounded-md bg-muted/50 p-2">
              <div className="text-muted-foreground">Fill rates</div>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
                {(["title", "location", "hares", "startTime", "runNumber"] as const).map(
                  (field) => {
                    const base = fillBaseline[field] ?? 0;
                    const curr = fillCurrent[field] ?? 0;
                    const changed = base !== curr;
                    return (
                      <span key={field} className={changed ? "font-medium" : "text-muted-foreground"}>
                        <span className="capitalize">{field === "startTime" ? "ST" : field === "runNumber" ? "R#" : field.charAt(0).toUpperCase()}</span>
                        {changed ? (
                          <span className={curr < base ? " text-red-600" : " text-green-600"}>
                            {" "}{base}→{curr}%
                          </span>
                        ) : (
                          <span> {curr}%</span>
                        )}
                      </span>
                    );
                  },
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Guidance */}
      <p className="text-muted-foreground">
        {qualityImpacted
          ? "The source HTML changed and data quality has degraded. Investigate the source page for template changes that may require adapter updates."
          : hasQualityData
            ? "The source HTML changed but event extraction is working normally. This alert will auto-resolve on the next stable scrape."
            : "The site template may have been updated. Check if event extraction still works."}
      </p>

      {/* Hash fingerprints (secondary detail) */}
      <div className="flex gap-3 text-muted-foreground/60">
        <span>
          <code className="text-[10px] bg-muted px-1 rounded">{prev}</code>
          {" → "}
          <code className="text-[10px] bg-muted px-1 rounded">{curr}</code>
        </span>
      </div>
    </div>
  );
}

function ScrapeFailureContext({
  context,
}: {
  context: Record<string, unknown>;
}) {
  const errors = (context.errorMessages as string[]) ?? [];
  const count = (context.consecutiveCount as number) ?? 1;

  return (
    <div className="text-xs mt-1 space-y-1">
      {count > 1 && (
        <div className="text-red-600 font-medium">
          {count} consecutive failures
        </div>
      )}
      {errors.length > 0 && (
        <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
          {errors.slice(0, 5).map((e, i) => (
            <li key={i} className="truncate" title={e}>
              {e}
            </li>
          ))}
          {errors.length > 5 && (
            <li className="text-muted-foreground/60">
              ...and {errors.length - 5} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function SourceKennelMismatchContext({
  context,
  details,
}: {
  context: Record<string, unknown>;
  details: string | null;
}) {
  const tags = (context.tags as string[]) ?? [];

  return (
    <div className="text-xs mt-1 space-y-2">
      {details && (
        <p className="text-muted-foreground">{details}</p>
      )}
      {tags.length > 0 && (
        <div className="space-y-1">
          <div className="text-muted-foreground font-medium">Blocked tags:</div>
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="text-muted-foreground">
        To allow these tags, link the corresponding kennels to this source.
      </p>
    </div>
  );
}
