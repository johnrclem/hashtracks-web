"use client";

import { AnimatedCounter } from "@/components/home/HeroAnimations";
import { Calendar, Flame, Users } from "lucide-react";

interface LogbookStatsProps {
  totalRuns: number;
  totalHares: number;
  uniqueKennels: number;
}

export function LogbookStatsCards({
  totalRuns,
  totalHares,
  uniqueKennels,
}: LogbookStatsProps) {
  const stats = [
    {
      icon: <Calendar className="h-5 w-5" />,
      value: totalRuns,
      label: "Total Runs",
      color: "#3b82f6",
      bg: "rgba(59, 130, 246, 0.08)",
    },
    {
      icon: <Flame className="h-5 w-5" />,
      value: totalHares,
      label: totalHares === 1 ? "Time Hared" : "Times Hared",
      color: "#f59e0b",
      bg: "rgba(245, 158, 11, 0.08)",
    },
    {
      icon: <Users className="h-5 w-5" />,
      value: uniqueKennels,
      label: uniqueKennels === 1 ? "Kennel" : "Kennels",
      color: "#10b981",
      bg: "rgba(16, 185, 129, 0.08)",
    },
  ];

  return (
    <div className="mt-5 grid grid-cols-3 gap-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-border/50 bg-card p-4 text-center"
        >
          <div
            className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg"
            style={{ backgroundColor: stat.bg, color: stat.color }}
          >
            {stat.icon}
          </div>
          <div className="text-2xl font-bold tracking-tight sm:text-3xl">
            <AnimatedCounter target={stat.value} />
          </div>
          <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
}
