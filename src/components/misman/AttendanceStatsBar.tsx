"use client";

import { PulseDot } from "@/components/home/HeroAnimations";

interface AttendanceStatsBarProps {
  attendeeCount: number;
  paidCount: number;
  hareCount: number;
  virginCount: number;
  visitorCount: number;
  lastSynced: string | null;
}

export function AttendanceStatsBar({
  attendeeCount,
  paidCount,
  hareCount,
  virginCount,
  visitorCount,
  lastSynced,
}: AttendanceStatsBarProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-3">
      <div className="grid grid-cols-5 gap-2 text-center">
        <div>
          <div className="text-lg font-bold tabular-nums">{attendeeCount}</div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Attendees
          </div>
        </div>
        <div>
          <div className="text-lg font-bold tabular-nums text-green-500">
            {paidCount}
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Paid
          </div>
        </div>
        <div>
          <div className="text-lg font-bold tabular-nums text-orange-500">
            {hareCount}
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Hares
          </div>
        </div>
        <div>
          <div className="text-lg font-bold tabular-nums text-pink-500">
            {virginCount}
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Virgins
          </div>
        </div>
        <div>
          <div className="text-lg font-bold tabular-nums text-blue-500">
            {visitorCount}
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Visitors
          </div>
        </div>
      </div>
      {lastSynced && (
        <div className="mt-2 flex items-center justify-center text-[10px] text-muted-foreground">
          <PulseDot />
          <span className="ml-1.5">Synced {lastSynced}</span>
        </div>
      )}
    </div>
  );
}
