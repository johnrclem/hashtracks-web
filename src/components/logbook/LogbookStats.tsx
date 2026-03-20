"use client";
/* eslint-disable react-hooks/refs */

import Link from "next/link";
import { Calendar, CheckCircle2, Flame, Target, Users } from "lucide-react";
import { levelColor, participationLevelLabel } from "@/lib/format";
import { getRegionColor } from "@/lib/region";
import { useInView } from "@/hooks/useInView";
import { AnimatedCounter } from "@/components/home/HeroAnimations";
import { RegionBadge } from "@/components/hareline/RegionBadge";
import { DayOfWeekChart } from "@/components/logbook/DayOfWeekChart";
import { RunsByYearChart } from "@/components/logbook/RunsByYearChart";

interface KennelStat {
  kennelId: string;
  shortName: string;
  fullName: string;
  slug: string;
  regionName: string;
  count: number;
}

interface MilestoneInfo {
  target: number;
  label: string;
  reached: boolean;
  eventTitle?: string | null;
  eventDate?: string;
  kennelShortName?: string;
}

interface LogbookStatsProps {
  totalRuns: number;
  totalHares: number;
  byKennel: KennelStat[];
  byRegion: { region: string; count: number }[];
  byLevel: { level: string; count: number }[];
  byDayOfWeek: { day: number; label: string; count: number }[];
  byYear: { year: number; count: number }[];
  milestones: MilestoneInfo[];
}

const STAT_CARDS = [
  { key: "runs", singular: "Total Run", plural: "Total Runs", icon: <Calendar className="h-5 w-5" />, color: "#3b82f6", bg: "rgba(59, 130, 246, 0.08)" },
  { key: "hares", singular: "Time Hared", plural: "Times Hared", icon: <Flame className="h-5 w-5" />, color: "#f59e0b", bg: "rgba(245, 158, 11, 0.08)" },
  { key: "kennels", singular: "Kennel", plural: "Kennels", icon: <Users className="h-5 w-5" />, color: "#10b981", bg: "rgba(16, 185, 129, 0.08)" },
] as const;

export function LogbookStats({
  totalRuns,
  totalHares,
  byKennel,
  byRegion,
  byLevel,
  byDayOfWeek,
  byYear,
  milestones,
}: LogbookStatsProps) {
  const statValues: Record<string, number> = {
    runs: totalRuns,
    hares: totalHares,
    kennels: byKennel.length,
  };

  const kennelMax = Math.max(...byKennel.map((k) => k.count), 1);
  const regionMax = Math.max(...byRegion.map((r) => r.count), 1);

  const kennelView = useInView<HTMLElement>();
  const regionView = useInView<HTMLElement>();
  const levelView = useInView<HTMLElement>();
  const milestoneView = useInView<HTMLElement>();

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {STAT_CARDS.map((stat) => (
          <div
            key={stat.key}
            className="rounded-xl border border-border/50 bg-card p-4 text-center"
          >
            <div
              className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg"
              style={{ backgroundColor: stat.bg, color: stat.color }}
            >
              {stat.icon}
            </div>
            <div className="text-2xl font-bold tracking-tight sm:text-3xl">
              <AnimatedCounter target={statValues[stat.key]} />
            </div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {statValues[stat.key] === 1 ? stat.singular : stat.plural}
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      {totalRuns > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <DayOfWeekChart data={byDayOfWeek} />
          <RunsByYearChart data={byYear} />
        </div>
      )}

      {/* Milestones */}
      <section
        ref={milestoneView.ref}
        className="rounded-xl border border-border/50 bg-card p-5"
      >
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Milestones
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {milestones.map((m) => (
            <div
              key={m.target}
              className={`rounded-xl border px-4 py-3 ${
                m.reached
                  ? "border-green-500/30 bg-green-50 dark:bg-green-950/20"
                  : "border-border/50"
              }`}
            >
              <div className="flex items-start gap-2.5">
                {m.reached ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
                ) : (
                  <Target className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/40" />
                )}
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className={`text-lg font-bold ${m.reached ? "" : "text-muted-foreground"}`}>
                      {m.target}
                    </span>
                    {m.label && (
                      <span className="text-xs text-muted-foreground">{m.label}</span>
                    )}
                  </div>
                  {m.reached ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {m.kennelShortName} — {m.eventDate}
                      {m.eventTitle ? ` — ${m.eventTitle}` : ""}
                    </p>
                  ) : (
                    <>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {m.target - totalRuns} more to go
                      </p>
                      <div className="mt-2 h-1 rounded-full bg-muted/30">
                        <div
                          className="h-1 rounded-full bg-green-500/50 transition-all duration-700 ease-out"
                          style={{
                            width: milestoneView.visible
                              ? `${Math.min((totalRuns / m.target) * 100, 100)}%`
                              : "0%",
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* By Kennel */}
      <section
        ref={kennelView.ref}
        className="rounded-xl border border-border/50 bg-card p-5"
      >
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          By Kennel
        </h3>
        <div className="space-y-2">
          {byKennel.map((k, i) => {
            const pct = (k.count / kennelMax) * 100;
            const color = getRegionColor(k.regionName);
            return (
              <div key={k.kennelId} className="flex items-center gap-3">
                <span className="flex min-w-[5rem] max-w-[8rem] shrink-0 items-center gap-1.5 truncate text-sm">
                  <Link
                    href={`/kennels/${k.slug}`}
                    className="truncate font-medium text-primary hover:underline"
                  >
                    {k.shortName}
                  </Link>
                  <RegionBadge region={k.regionName} size="sm" />
                </span>
                <div className="relative h-5 flex-1 rounded-full bg-muted/20">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: kennelView.visible ? `${Math.max(pct, 4)}%` : "0%",
                      transitionDelay: `${i * 60}ms`,
                      background: `linear-gradient(to right, ${color}99, ${color})`,
                    }}
                  />
                </div>
                <span
                  className="w-12 text-right text-xs font-semibold tabular-nums transition-opacity duration-500"
                  style={{
                    opacity: kennelView.visible ? 1 : 0,
                    transitionDelay: `${i * 60 + 400}ms`,
                  }}
                >
                  {k.count}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* By Region */}
      <section
        ref={regionView.ref}
        className="rounded-xl border border-border/50 bg-card p-5"
      >
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          By Region
        </h3>
        <div className="space-y-2">
          {byRegion.map((r, i) => {
            const pct = (r.count / regionMax) * 100;
            const color = getRegionColor(r.region);
            return (
              <div key={r.region} className="flex items-center gap-3">
                <span className="min-w-[8rem] shrink-0 truncate text-sm font-medium">
                  {r.region}
                </span>
                <div className="relative h-5 flex-1 rounded-full bg-muted/20">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: regionView.visible ? `${Math.max(pct, 4)}%` : "0%",
                      transitionDelay: `${i * 80}ms`,
                      background: `linear-gradient(to right, ${color}99, ${color})`,
                    }}
                  />
                </div>
                <span
                  className="w-12 text-right text-xs font-semibold tabular-nums transition-opacity duration-500"
                  style={{
                    opacity: regionView.visible ? 1 : 0,
                    transitionDelay: `${i * 80 + 400}ms`,
                  }}
                >
                  {r.count}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* By Participation Level */}
      <section
        ref={levelView.ref}
        className="rounded-xl border border-border/50 bg-card p-5"
      >
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Participation
        </h3>
        {totalRuns > 0 && (
          <div className="flex h-6 w-full overflow-hidden rounded-full bg-muted/20">
            {byLevel.map((l, i) => (
              <div
                key={l.level}
                className="transition-all duration-700 ease-out"
                style={{
                  width: levelView.visible ? `${(l.count / totalRuns) * 100}%` : "0%",
                  backgroundColor: levelColor(l.level),
                  transitionDelay: `${i * 100}ms`,
                }}
              />
            ))}
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
          {byLevel.map((l) => (
            <div key={l.level} className="flex items-center gap-2 text-sm">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: levelColor(l.level) }}
              />
              <span className="font-medium">{participationLevelLabel(l.level)}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">
                {l.count}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
