"use client";

import { AnimatedCounter } from "@/components/home/HeroAnimations";
import { getRegionColor, hexToRgb } from "@/lib/region";
import { Calendar, Clock, ArrowRight } from "lucide-react";

interface KennelStatsProps {
  highestRunNumber: number | null;
  totalEvents: number;
  oldestEventDate: string | null;
  nextRunDate: string | null;
  foundedYear?: number | null;
  region?: string;
}

function formatNextRun(nextRunDate: string): string {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);
  const runUtc = new Date(nextRunDate).getTime();
  const diffDays = Math.round((runUtc - todayUtc) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays > 0 && diffDays <= 30) return `in ${diffDays} days`;
  return new Date(nextRunDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function computeYearsActive(
  foundedYear: number | null | undefined,
  oldestEventDate: string | null,
): number | null {
  const currentYear = new Date().getUTCFullYear();
  if (foundedYear) return currentYear - foundedYear;
  if (oldestEventDate) {
    const year = new Date(oldestEventDate).getUTCFullYear();
    return currentYear - year;
  }
  return null;
}

export function KennelStats({
  highestRunNumber,
  totalEvents,
  oldestEventDate,
  nextRunDate,
  foundedYear,
  region,
}: KennelStatsProps) {
  if (totalEvents === 0) return null;

  const hex = region ? getRegionColor(region) : "#6b7280";
  const [r, g, b] = hexToRgb(hex);
  const accentBg = `rgba(${r}, ${g}, ${b}, 0.08)`;
  const accentColor = `rgb(${r}, ${g}, ${b})`;

  const yearsActive = computeYearsActive(foundedYear, oldestEventDate);

  // Prefer highest run number (kennel's actual count); fall back to events tracked
  const runsValue = highestRunNumber ?? totalEvents;
  const runsLabel = highestRunNumber ? "Total Runs" : "Events Tracked";

  const stats: {
    icon: React.ReactNode;
    value: React.ReactNode;
    label: string;
  }[] = [
    {
      icon: <Calendar className="h-5 w-5" />,
      value: <AnimatedCounter target={runsValue} />,
      label: runsLabel,
    },
  ];

  if (yearsActive !== null && yearsActive > 0) {
    stats.push({
      icon: <Clock className="h-5 w-5" />,
      value: <AnimatedCounter target={yearsActive} />,
      label: yearsActive === 1 ? "Year Active" : "Years Active",
    });
  }

  if (nextRunDate) {
    stats.push({
      icon: <ArrowRight className="h-5 w-5" />,
      value: formatNextRun(nextRunDate),
      label: "Next Run",
    });
  }

  return (
    <div
      className={`grid gap-3 ${
        stats.length === 3
          ? "grid-cols-3"
          : stats.length === 2
            ? "grid-cols-2"
            : "grid-cols-1 max-w-[200px]"
      }`}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-border/50 bg-card p-4 text-center"
        >
          <div
            className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg"
            style={{ backgroundColor: accentBg, color: accentColor }}
          >
            {stat.icon}
          </div>
          <div className="text-2xl font-bold tracking-tight sm:text-3xl">
            {stat.value}
          </div>
          <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
}
