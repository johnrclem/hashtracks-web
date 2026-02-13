"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  recordAttendance,
  removeAttendance,
  updateAttendance,
  clearEventAttendance,
  getEventAttendance,
  quickAddHasher,
} from "@/app/misman/[slug]/attendance/actions";
import { searchRoster } from "@/app/misman/[slug]/roster/actions";
import { EventSelector } from "./EventSelector";
import { AttendanceRow } from "./AttendanceRow";
import { HasherSearch } from "./HasherSearch";

interface EventOption {
  id: string;
  date: string;
  title: string | null;
  runNumber: number | null;
  kennelShortName: string;
}

export interface AttendanceRecord {
  id: string;
  kennelHasherId: string;
  hashName: string | null;
  nerdName: string | null;
  paid: boolean;
  haredThisTrail: boolean;
  isVirgin: boolean;
  isVisitor: boolean;
  visitorLocation: string | null;
  referralSource: string | null;
  referralOther: string | null;
  recordedBy: string;
  createdAt: string;
}

interface AttendanceFormProps {
  events: EventOption[];
  defaultEventId: string | null;
  kennelId: string;
  kennelSlug: string;
  kennelShortName: string;
}

export function AttendanceForm({
  events,
  defaultEventId,
  kennelId,
  kennelSlug,
  kennelShortName,
}: AttendanceFormProps) {
  const [selectedEventId, setSelectedEventId] = useState(defaultEventId);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Fetch attendance data for selected event
  const fetchAttendance = useCallback(async () => {
    if (!selectedEventId) return;
    const result = await getEventAttendance(kennelId, selectedEventId);
    if (result.data) {
      setRecords(result.data);
      setLastSynced(new Date().toLocaleTimeString());
    }
  }, [selectedEventId, kennelId]);

  // Initial fetch when event changes
  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  // Polling every 4 seconds
  useEffect(() => {
    if (!selectedEventId) return;
    const interval = setInterval(fetchAttendance, 4000);
    return () => clearInterval(interval);
  }, [selectedEventId, fetchAttendance]);

  function handleAddHasher(hasherId: string) {
    startTransition(async () => {
      const result = await recordAttendance(kennelId, selectedEventId!, hasherId);
      if (result.error) {
        toast.error(result.error);
      } else {
        await fetchAttendance();
      }
    });
  }

  function handleQuickAdd(data: { hashName?: string; nerdName?: string }) {
    if (!selectedEventId) return;
    startTransition(async () => {
      const result = await quickAddHasher(kennelId, selectedEventId, data);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Hasher added");
        await fetchAttendance();
      }
    });
  }

  function handleRemove(attendanceId: string) {
    startTransition(async () => {
      const result = await removeAttendance(kennelId, attendanceId);
      if (result.error) {
        toast.error(result.error);
      } else {
        setRecords((prev) => prev.filter((r) => r.id !== attendanceId));
      }
    });
  }

  function handleUpdate(
    attendanceId: string,
    data: {
      paid?: boolean;
      haredThisTrail?: boolean;
      isVirgin?: boolean;
      isVisitor?: boolean;
      visitorLocation?: string;
      referralSource?: string;
      referralOther?: string;
    },
  ) {
    startTransition(async () => {
      const result = await updateAttendance(kennelId, attendanceId, data);
      if (result.error) {
        toast.error(result.error);
      } else {
        await fetchAttendance();
      }
    });
  }

  function handleClear() {
    if (!selectedEventId) return;
    const count = records.length;
    if (
      !confirm(
        `This will delete ${count} attendance record${count !== 1 ? "s" : ""} for this event. This cannot be undone. Continue?`,
      )
    )
      return;

    startTransition(async () => {
      const result = await clearEventAttendance(kennelId, selectedEventId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Cleared ${result.deleted} record(s)`);
        setRecords([]);
      }
    });
  }

  const selectedEvent = events.find((e) => e.id === selectedEventId);
  const attendedHasherIds = new Set(records.map((r) => r.kennelHasherId));

  // Stats
  const paidCount = records.filter((r) => r.paid).length;
  const hareCount = records.filter((r) => r.haredThisTrail).length;
  const virginCount = records.filter((r) => r.isVirgin).length;
  const visitorCount = records.filter((r) => r.isVisitor).length;

  if (events.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground">
        No events found for {kennelShortName} in the past year.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Event selector */}
      <EventSelector
        events={events}
        selectedEventId={selectedEventId}
        onSelect={(id) => setSelectedEventId(id)}
        kennelSlug={kennelSlug}
      />

      {selectedEvent && (
        <>
          {/* Stats bar */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{records.length} attendees</Badge>
            {paidCount > 0 && (
              <Badge variant="outline">{paidCount} paid</Badge>
            )}
            {hareCount > 0 && (
              <Badge variant="outline">{hareCount} hare{hareCount !== 1 ? "s" : ""}</Badge>
            )}
            {virginCount > 0 && (
              <Badge variant="outline">{virginCount} virgin{virginCount !== 1 ? "s" : ""}</Badge>
            )}
            {visitorCount > 0 && (
              <Badge variant="outline">{visitorCount} visitor{visitorCount !== 1 ? "s" : ""}</Badge>
            )}
            {lastSynced && (
              <span className="ml-auto text-xs text-muted-foreground">
                Synced {lastSynced}
              </span>
            )}
          </div>

          {/* Hasher search / add */}
          <HasherSearch
            kennelId={kennelId}
            attendedHasherIds={attendedHasherIds}
            onSelect={handleAddHasher}
            onQuickAdd={handleQuickAdd}
            disabled={isPending}
          />

          {/* Attendance list */}
          <div className="space-y-1">
            {records.map((record) => (
              <AttendanceRow
                key={record.id}
                record={record}
                onUpdate={(data) => handleUpdate(record.id, data)}
                onRemove={() => handleRemove(record.id)}
                disabled={isPending}
              />
            ))}
          </div>

          {/* Clear button */}
          {records.length > 0 && (
            <div className="pt-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={handleClear}
                disabled={isPending}
              >
                Clear All Attendance
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
