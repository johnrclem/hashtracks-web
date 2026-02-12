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

  return (
    <div className="text-xs mt-1 space-y-1">
      <div className="flex gap-2">
        <span className="text-muted-foreground">Previous:</span>
        <code className="text-[10px] bg-muted px-1 rounded">{prev}...</code>
      </div>
      <div className="flex gap-2">
        <span className="text-muted-foreground">Current:</span>
        <code className="text-[10px] bg-muted px-1 rounded">{curr}...</code>
      </div>
      <p className="text-muted-foreground">
        The site template may have been updated. Check if event extraction still works.
      </p>
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
