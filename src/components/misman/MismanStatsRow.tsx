"use client";

import { Calendar, Users, Clock } from "lucide-react";
import { AnimatedCounter } from "@/components/home/HeroAnimations";

interface MismanStatsRowProps {
  totalAttendance: number;
  rosterSize: number;
  lastRecordedLabel: string | null;
}

export function MismanStatsRow({
  totalAttendance,
  rosterSize,
  lastRecordedLabel,
}: MismanStatsRowProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="rounded-xl border border-border/50 bg-card p-4 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/[0.08]">
          <Calendar className="h-5 w-5 text-blue-500" />
        </div>
        <div className="text-2xl font-bold tracking-tight">
          <AnimatedCounter target={totalAttendance} />
        </div>
        <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Attendance
        </div>
      </div>
      <div className="rounded-xl border border-border/50 bg-card p-4 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/[0.08]">
          <Users className="h-5 w-5 text-green-500" />
        </div>
        <div className="text-2xl font-bold tracking-tight">
          <AnimatedCounter target={rosterSize} />
        </div>
        <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Roster
        </div>
      </div>
      <div className="rounded-xl border border-border/50 bg-card p-4 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/[0.08]">
          <Clock className="h-5 w-5 text-orange-500" />
        </div>
        <div className="text-sm font-bold tracking-tight">
          {lastRecordedLabel || "—"}
        </div>
        <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Last Recorded
        </div>
      </div>
    </div>
  );
}
