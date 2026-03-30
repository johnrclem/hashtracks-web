"use client";

import { AnimatedCounter } from "@/components/home/HeroAnimations";
import { getRegionColor, hexToRgb } from "@/lib/region";
import { Calendar, Clock, ArrowRight, Hash } from "lucide-react";

interface KennelStatsProps {
  currentRunNumber: number | null;
  totalEvents: number;
  oldestEventDate: string | null;
  nextRunDate: string | null;
  lastEventDate: string | null;
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

function formatLastRun(lastEventDate: string): string {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);
  const eventUtc = new Date(lastEventDate).getTime();
  const diffDays = Math.round((todayUtc - eventUtc) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 30) return `${diffDays} days ago`;
  if (diffDays <= 365) {
    const months = Math.round(diffDays / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  return new Date(lastEventDate).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
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
  currentRunNumber,
  totalEvents,
  oldestEventDate,
  nextRunDate,
  lastEventDate,
  foundedYear,
  region,
}: KennelStatsProps) {
  if (totalEvents === 0 && !lastEventDate) return null;

  const hex = region ? getRegionColor(region) : "#6b7280";
  const [r, g, b] = hexToRgb(hex);
  const accentBg = `rgba(${r}, ${g}, ${b}, 0.08)`;
  const accentColor = `rgb(${r}, ${g}, ${b})`;

  const yearsActive = computeYearsActive(foundedYear, oldestEventDate);

  const stats: {
    icon: React.ReactNode;
    value: React.ReactNode;
    label: string;
  }[] = [];

  if (currentRunNumber) {
    stats.push({
      icon: <Hash className="h-5 w-5" />,
      value: <AnimatedCounter target={currentRunNumber} />,
      label: "Latest Run",
    });
  }
  if (!currentRunNumber) {
    stats.push({
      icon: <Calendar className="h-5 w-5" />,
      value: <AnimatedCounter target={totalEvents} />,
      label: "Events Tracked",
    });
  }

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
  } else if (lastEventDate) {
    stats.push({
      icon: <Clock className="h-5 w-5" />,
      value: formatLastRun(lastEventDate),
      label: "Last Run",
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
