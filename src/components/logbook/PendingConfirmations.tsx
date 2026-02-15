"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getPendingConfirmations,
  confirmMismanAttendance,
} from "@/app/logbook/actions";

interface PendingRecord {
  kennelAttendanceId: string;
  eventId: string;
  eventDate: string;
  eventTitle: string | null;
  runNumber: number | null;
  kennelShortName: string;
  haredThisTrail: boolean;
}

export function PendingConfirmations() {
  const [pending, setPending] = useState<PendingRecord[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    getPendingConfirmations().then((result) => {
      if (result.data) setPending(result.data);
      setLoaded(true);
    });

    // Restore dismissed IDs from localStorage
    try {
      const stored = localStorage.getItem("dismissed-misman-confirmations");
      if (stored) setDismissed(new Set(JSON.parse(stored)));
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  function handleConfirm(kennelAttendanceId: string) {
    startTransition(async () => {
      const result = await confirmMismanAttendance(kennelAttendanceId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Added to your logbook");
        setPending((prev) =>
          prev.filter((p) => p.kennelAttendanceId !== kennelAttendanceId),
        );
        router.refresh();
      }
    });
  }

  function handleDismiss(kennelAttendanceId: string) {
    const next = new Set(dismissed);
    next.add(kennelAttendanceId);
    setDismissed(next);
    try {
      localStorage.setItem(
        "dismissed-misman-confirmations",
        JSON.stringify([...next]),
      );
    } catch {
      // Ignore localStorage errors
    }
  }

  const visible = pending.filter((p) => !dismissed.has(p.kennelAttendanceId));

  if (!loaded || visible.length === 0) return null;

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "America/New_York",
    });
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">
        Pending Confirmations ({visible.length})
      </h3>
      <p className="text-xs text-muted-foreground">
        A misman recorded your attendance at these events. Confirm to add them
        to your logbook.
      </p>
      <div className="space-y-2">
        {visible.map((p) => (
          <div
            key={p.kennelAttendanceId}
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="shrink-0 text-xs">
                  {p.kennelShortName}
                </Badge>
                <span className="font-medium truncate">
                  {p.runNumber ? `#${p.runNumber}` : ""}
                  {p.runNumber && p.eventTitle ? " — " : ""}
                  {p.eventTitle || (p.runNumber ? "" : "Untitled")}
                </span>
                {p.haredThisTrail && (
                  <span className="text-xs text-orange-600 shrink-0">Hare</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDate(p.eventDate)}
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={() => handleConfirm(p.kennelAttendanceId)}
                disabled={isPending}
              >
                Confirm
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => handleDismiss(p.kennelAttendanceId)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
