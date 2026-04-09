"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
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
import { AuditStream } from "@/generated/prisma/client";
import {
  type StreamTrendPoint,
  type StreamOpenCounts,
  type RecentOpenIssue,
  DASHBOARD_STREAMS,
} from "@/app/admin/audit/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Props {
  streamTrends: StreamTrendPoint[];
  openCounts: StreamOpenCounts[];
  recentOpenIssues: RecentOpenIssue[];
}

const STREAM_META: Record<AuditStream, { label: string; color: string; icon: typeof Bot }> = {
  AUTOMATED: { label: "Automated", color: "#3b82f6", icon: Bot },
  CHROME_EVENT: { label: "Chrome — Daily", color: "#22c55e", icon: Eye },
  CHROME_KENNEL: { label: "Chrome — Deep Dive", color: "#a855f7", icon: Microscope },
  UNKNOWN: { label: "Unknown / Pre-cutover", color: "#94a3b8", icon: HelpCircle },
};

const PRIMARY_STREAMS: AuditStream[] = [
  AuditStream.AUTOMATED,
  AuditStream.CHROME_EVENT,
  AuditStream.CHROME_KENNEL,
];

export function AuditStreamPanel({ streamTrends, openCounts, recentOpenIssues }: Props) {
  const [showUnknown, setShowUnknown] = useState(false);
  const visibleStreams = showUnknown ? DASHBOARD_STREAMS : PRIMARY_STREAMS;

  // Flatten the trend data for recharts: one row per date with opened/closed
  // numeric fields per stream prefix.
  const chartData = useMemo(
    () =>
      streamTrends.map((point) => {
        const row: Record<string, string | number> = { date: point.date };
        for (const stream of visibleStreams) {
          row[`${stream}_opened`] = point[stream].opened;
          row[`${stream}_closed`] = point[stream].closed;
        }
        return row;
      }),
    [streamTrends, visibleStreams],
  );

  const reopensThisWeek = useMemo(() => {
    let total = 0;
    for (const point of streamTrends) {
      for (const stream of visibleStreams) total += point[stream].reopened;
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
            onClick={() => setShowUnknown((v) => !v)}
          >
            {showUnknown ? "Hide" : "Show"} pre-cutover history
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {PRIMARY_STREAMS.map((stream) => {
          const meta = STREAM_META[stream];
          const counts = openCounts.find((c) => c.stream === stream);
          const open = counts?.open ?? 0;
          const delta = open - (counts?.openWeekAgo ?? 0);
          return <StreamStatCard key={stream} meta={meta} open={open} delta={delta} />;
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
              {visibleStreams.map((stream) => (
                <Area
                  key={`${stream}_opened`}
                  type="monotone"
                  dataKey={`${stream}_opened`}
                  name={`${STREAM_META[stream].label} opened`}
                  stackId="opened"
                  stroke={STREAM_META[stream].color}
                  fill={STREAM_META[stream].color}
                  fillOpacity={0.35}
                />
              ))}
              {visibleStreams.map((stream) => (
                <Line
                  key={`${stream}_closed`}
                  type="monotone"
                  dataKey={`${stream}_closed`}
                  name={`${STREAM_META[stream].label} closed`}
                  stroke={STREAM_META[stream].color}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                />
              ))}
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
            {PRIMARY_STREAMS.map((stream) => {
              const meta = STREAM_META[stream];
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
}

function StreamStatCard({ meta, open, delta }: StreamStatCardProps) {
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
    </div>
  );
}
