"use client";

import { useMemo, useState } from "react";
import {
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Line,
  ComposedChart,
} from "recharts";
import { ArrowDown, ArrowUp, Minus, Bot, Eye, Microscope, HelpCircle } from "lucide-react";
import {
  AUDIT_STREAM,
  PRIMARY_STREAMS,
  type AuditStream,
} from "@/lib/audit-stream-meta";
import type {
  StreamTrendPoint,
  StreamOpenCounts,
  StreamCloseReasonRatio,
  RecentOpenIssue,
  StreamDayBucket,
} from "@/app/admin/audit/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Props {
  streamTrends: StreamTrendPoint[];
  openCounts: StreamOpenCounts[];
  /** Per-stream `state_reason="not_planned"` ratios over the last 14 days.
   *  A high ratio is the audit prompt over-flagging — operators close
   *  those issues with "Close as not planned" rather than fixing them.
   *  `null` when the underlying query failed (schema skew, transient
   *  DB error); the panel renders an explicit "metric unavailable"
   *  line in that case so failures don't masquerade as zero activity. */
  closeReasonRatios: StreamCloseReasonRatio[] | null;
  recentOpenIssues: RecentOpenIssue[];
}

interface StreamMeta {
  label: string;
  color: string;
  icon: typeof Bot;
}

/**
 * Stream metadata as a Map to satisfy eslint-plugin-security's object-
 * injection rule. The keys are typed AuditStream literals so dynamic
 * lookups remain type-safe even though the runtime value is data-driven.
 */
const STREAM_META: ReadonlyMap<AuditStream, StreamMeta> = new Map([
  [AUDIT_STREAM.AUTOMATED, { label: "Automated", color: "#3b82f6", icon: Bot }],
  [AUDIT_STREAM.CHROME_EVENT, { label: "Chrome — Daily", color: "#22c55e", icon: Eye }],
  [AUDIT_STREAM.CHROME_KENNEL, { label: "Chrome — Deep Dive", color: "#a855f7", icon: Microscope }],
  [AUDIT_STREAM.UNKNOWN, { label: "Unknown / Pre-cutover", color: "#94a3b8", icon: HelpCircle }],
]);

function metaFor(stream: AuditStream): StreamMeta {
  // Map.get() can return undefined per its type signature, but our key set
  // exhaustively covers AuditStream so this fallback only fires if someone
  // adds a new enum value without updating STREAM_META.
  return (
    STREAM_META.get(stream) ?? { label: stream, color: "#94a3b8", icon: HelpCircle }
  );
}

function bucketFor(point: StreamTrendPoint, stream: AuditStream): StreamDayBucket {
  // Same exhaustive-coverage rationale as metaFor — every emptyStreamPoint
  // creates a bucket per stream so this fallback is dead code at runtime,
  // but it tells eslint-plugin-security the access is bounded.
  return point[stream] ?? { opened: 0, closed: 0, reopened: 0, net: 0 };
}

const ALL_STREAMS: readonly AuditStream[] = [
  AUDIT_STREAM.AUTOMATED,
  AUDIT_STREAM.CHROME_EVENT,
  AUDIT_STREAM.CHROME_KENNEL,
  AUDIT_STREAM.UNKNOWN,
];

export function AuditStreamPanel({
  streamTrends,
  openCounts,
  closeReasonRatios,
  recentOpenIssues,
}: Props) {
  const [showUnknown, setShowUnknown] = useState(false);
  const visibleStreams = showUnknown ? ALL_STREAMS : PRIMARY_STREAMS;

  // Flatten the trend data for recharts: one row per date with opened/closed
  // numeric fields per stream prefix.
  const chartData = useMemo(
    () =>
      streamTrends.map((point) => {
        const row: Record<string, string | number> = { date: point.date };
        for (const stream of visibleStreams) {
          const bucket = bucketFor(point, stream);
          row[`${stream}_opened`] = bucket.opened;
          row[`${stream}_closed`] = bucket.closed;
        }
        return row;
      }),
    [streamTrends, visibleStreams],
  );

  const reopensThisWeek = useMemo(() => {
    let total = 0;
    for (const point of streamTrends) {
      for (const stream of visibleStreams) total += bucketFor(point, stream).reopened;
    }
    return total;
  }, [streamTrends, visibleStreams]);

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold">Findings by stream</h2>
        <div className="flex items-center gap-2">
          {reopensThisWeek > 0 && (
            <Badge variant="secondary" className="text-xs">
              {reopensThisWeek} reopen{reopensThisWeek === 1 ? "" : "s"} (30d)
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => {
              setShowUnknown((v) => !v);
            }}
          >
            {showUnknown ? "Hide" : "Show"} pre-cutover history
          </Button>
        </div>
      </div>

      {/* Stat cards — extends to 4 columns when UNKNOWN is visible. */}
      <div
        className={`grid grid-cols-1 gap-4 ${showUnknown ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}
      >
        {visibleStreams.map((stream) => {
          const counts = openCounts.find((c) => c.stream === stream);
          const open = counts?.open ?? 0;
          const delta = open - (counts?.openWeekAgo ?? 0);
          const ratio = closeReasonRatios?.find((r) => r.stream === stream) ?? null;
          return (
            <StreamStatCard
              key={stream}
              meta={metaFor(stream)}
              open={open}
              delta={delta}
              ratio={closeReasonRatios === null ? "unavailable" : ratio}
            />
          );
        })}
      </div>

      {/* Stacked area chart of opened/closed by day per stream */}
      {chartData.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card p-5">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Opened (filled) vs Closed (dashed) — last 30 days
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis
                dataKey="date"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {visibleStreams.map((stream) => {
                const meta = metaFor(stream);
                return (
                  <Area
                    key={`${stream}_opened`}
                    type="monotone"
                    dataKey={`${stream}_opened`}
                    name={`${meta.label} opened`}
                    stackId="opened"
                    stroke={meta.color}
                    fill={meta.color}
                    fillOpacity={0.35}
                  />
                );
              })}
              {visibleStreams.map((stream) => {
                const meta = metaFor(stream);
                return (
                  <Line
                    key={`${stream}_closed`}
                    type="monotone"
                    dataKey={`${stream}_closed`}
                    name={`${meta.label} closed`}
                    stroke={meta.color}
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent open issues by stream */}
      {recentOpenIssues.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card p-5">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recent open issues
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {visibleStreams.map((stream) => {
              const meta = metaFor(stream);
              const Icon = meta.icon;
              const issues = recentOpenIssues.filter((i) => i.stream === stream).slice(0, 5);
              return (
                <div key={stream} className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium" style={{ color: meta.color }}>
                    <Icon className="h-3.5 w-3.5" />
                    {meta.label}
                  </div>
                  {issues.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No open issues</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {issues.map((i) => (
                        <li key={i.githubNumber} className="text-xs">
                          <a
                            href={i.htmlUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="line-clamp-2 text-muted-foreground hover:text-foreground hover:underline"
                          >
                            #{i.githubNumber} {i.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

interface StreamStatCardProps {
  meta: { label: string; color: string; icon: typeof Bot };
  open: number;
  delta: number;
  /**
   *  - `StreamCloseReasonRatio`: render the ratio (or "X closed / 14d"
   *    if the known-reason denominator is below the noise floor).
   *  - `null`: this stream has no row in the result. Render zero state.
   *  - `"unavailable"`: the upstream query failed. Render an explicit
   *    error line so operators don't mistake it for a zero-activity
   *    period.
   */
  ratio: StreamCloseReasonRatio | null | "unavailable";
}

/** Above this threshold the audit prompt is likely over-flagging:
 *  operators are closing as not-planned rather than fixing. */
const NOT_PLANNED_HIGH_PCT = 50;

function StreamStatCard({ meta, open, delta, ratio }: StreamStatCardProps) {
  const Icon = meta.icon;
  // Down/green = improving (fewer open issues), up/orange = regressing.
  const DeltaIcon = delta < 0 ? ArrowDown : delta > 0 ? ArrowUp : Minus;
  const deltaColor =
    delta < 0 ? "text-emerald-500" : delta > 0 ? "text-orange-500" : "text-muted-foreground";

  return (
    <div className="rounded-xl border border-border/50 bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{meta.label}</p>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{open}</span>
        <span className="text-xs text-muted-foreground">open</span>
      </div>
      <div className={`mt-1 flex items-center gap-1 text-xs ${deltaColor}`}>
        <DeltaIcon className="h-3 w-3" />
        <span>
          {delta === 0 ? "no change" : `${Math.abs(delta)} vs 7d ago`}
        </span>
      </div>
      <RatioLine ratio={ratio} />
    </div>
  );
}

/** Default window size shown when the ratio prop is null/unavailable
 *  (no row to read `windowDays` from). Kept short to stay in sync with
 *  the server's `CLOSE_REASON_WINDOW_DAYS` default — the value is only
 *  rendered in zero-state text, never in the live ratio. */
const DEFAULT_WINDOW_DAYS = 14;

function RatioLine({ ratio }: { ratio: StreamCloseReasonRatio | null | "unavailable" }) {
  if (ratio === "unavailable") {
    return (
      <div className="mt-1 text-xs text-orange-500">not-planned ratio unavailable</div>
    );
  }
  const windowDays = ratio?.windowDays ?? DEFAULT_WINDOW_DAYS;
  if (ratio === null || ratio.closedTotal === 0) {
    return (
      <div className="mt-1 text-xs text-muted-foreground">
        0 closed / {windowDays}d
      </div>
    );
  }
  // High not-planned% means many closures are "won't fix" — orange so it
  // visibly competes with the delta indicator.
  const isHigh =
    ratio.notPlannedPct !== null && ratio.notPlannedPct >= NOT_PLANNED_HIGH_PCT;
  const color = isHigh ? "text-orange-500" : "text-muted-foreground";
  // When some closures are not yet synced (legacy null closeReason rows),
  // surface the unknown count so operators can see the metric is
  // mid-rollout rather than reflecting a clean denominator.
  const unknownSuffix = ratio.closedUnknown > 0 ? `, ${ratio.closedUnknown} not yet synced` : "";
  return (
    <div className={`mt-1 text-xs ${color}`}>
      {ratio.notPlannedPct === null
        ? `${ratio.closedTotal} closed / ${windowDays}d${unknownSuffix}`
        : `${ratio.notPlannedPct}% not-planned (${ratio.closedTotal} closed / ${windowDays}d${unknownSuffix})`}
    </div>
  );
}
