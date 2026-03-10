"use client";

import { useState, useEffect, useMemo, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  recordAttendance,
  removeAttendance,
  updateAttendance,
  clearEventAttendance,
  getEventAttendance,
  quickAddHasher,
  getSuggestions,
  getHasherForEdit,
} from "@/app/misman/[slug]/attendance/actions";
import { searchRoster } from "@/app/misman/[slug]/roster/actions";
import { EventSelector } from "./EventSelector";
import { AttendanceStatsBar } from "./AttendanceStatsBar";
import { AttendanceRow } from "./AttendanceRow";
import { HasherSearch } from "./HasherSearch";
import { HasherForm } from "./HasherForm";
import { SuggestionList } from "./SuggestionList";
import { UserActivitySection } from "./UserActivitySection";

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
  hasEdits?: boolean;
  attendanceCount?: number;
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
  const [userActivity, setUserActivity] = useState<
    Array<{
      userId: string;
      hashName: string | null;
      email: string;
      status: string;
      isLinked: boolean;
      linkedHasherId: string | null;
    }>
  >([]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [suggestions, setSuggestions] = useState<
    Array<{ kennelHasherId: string; hashName: string | null; nerdName: string | null; score: number }>
  >([]);
  const [editingHasher, setEditingHasher] = useState<{
    id: string;
    hashName: string | null;
    nerdName: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Fetch suggestions once on mount (stable within a session)
  useEffect(() => {
    getSuggestions(kennelId).then((result) => {
      if (result.data) setSuggestions(result.data);
    });
  }, [kennelId]);

  // Fetch attendance data for selected event
  const fetchAttendance = useCallback(async () => {
    if (!selectedEventId) return;
    const result = await getEventAttendance(kennelId, selectedEventId);
    if (result.data) {
      setRecords((prev) => {
        const next = result.data!;
        if (prev.length === next.length && prev.every((r, i) => r.id === next[i].id && r.paid === next[i].paid && r.haredThisTrail === next[i].haredThisTrail && r.isVirgin === next[i].isVirgin && r.isVisitor === next[i].isVisitor)) {
          return prev;
        }
        return next;
      });
      if (result.userActivity) setUserActivity(result.userActivity);
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
      if ("error" in result) {
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
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Hasher added");
        await fetchAttendance();
      }
    });
  }

  async function handleEdit(record: AttendanceRecord) {
    const result = await getHasherForEdit(kennelId, record.kennelHasherId);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    if (result.data) {
      setEditingHasher(result.data);
    }
  }

  function handleEditClose() {
    setEditingHasher(null);
    fetchAttendance();
  }

  function removeRecordFromState(id: string) {
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }

  function handleRemove(attendanceId: string) {
    startTransition(async () => {
      const result = await removeAttendance(kennelId, attendanceId);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        removeRecordFromState(attendanceId);
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
      if ("error" in result) {
        toast.error(result.error);
      } else {
        await fetchAttendance();
      }
    });
  }

  function executeClear() {
    if (!selectedEventId) return;
    startTransition(async () => {
      const result = await clearEventAttendance(kennelId, selectedEventId);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`Cleared ${result.deleted} record(s)`);
        setRecords([]);
      }
      setShowClearConfirm(false);
    });
  }

  const selectedEvent = events.find((e) => e.id === selectedEventId);
  const attendedHasherIds = useMemo(
    () => new Set(records.map((r) => r.kennelHasherId)),
    [records],
  );

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
      {/* Sticky header: Event selector + Stats bar */}
      <div className="sticky top-0 z-20 -mx-4 bg-background px-4 pb-3 pt-1 sm:static sm:mx-0 sm:px-0 sm:pb-0 sm:pt-0">
        <EventSelector
          events={events}
          selectedEventId={selectedEventId}
          onSelect={(id) => setSelectedEventId(id)}
          kennelSlug={kennelSlug}
        />

        {selectedEvent && (
          <div className="mt-3">
            <AttendanceStatsBar
              attendeeCount={records.length}
              paidCount={paidCount}
              hareCount={hareCount}
              virginCount={virginCount}
              visitorCount={visitorCount}
              lastSynced={lastSynced}
            />
          </div>
        )}
      </div>

      {selectedEvent && (
        <>

          {/* User Activity (RSVPs + check-ins from site users) */}
          {userActivity.length > 0 && (
            <UserActivitySection
              userActivity={userActivity}
              kennelId={kennelId}
              disabled={isPending}
              onRefresh={fetchAttendance}
              attendedHasherIds={attendedHasherIds}
              onAddToAttendance={handleAddHasher}
            />
          )}

          {/* Smart suggestions */}
          {suggestions.length > 0 && (
            <SuggestionList
              suggestions={suggestions}
              attendedHasherIds={attendedHasherIds}
              onSelect={handleAddHasher}
              disabled={isPending || !selectedEventId}
            />
          )}

          {/* Hasher search / add */}
          <HasherSearch
            kennelId={kennelId}
            attendedHasherIds={attendedHasherIds}
            onSelect={handleAddHasher}
            onQuickAdd={handleQuickAdd}
            disabled={isPending}
          />

          {/* Attendance list */}
          <div className="space-y-2">
            {records.map((record) => (
              <AttendanceRow
                key={record.id}
                record={record}
                onUpdate={(data) => handleUpdate(record.id, data)}
                onRemove={() => handleRemove(record.id)}
                onEdit={() => handleEdit(record)}
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
                onClick={() => setShowClearConfirm(true)}
                disabled={isPending}
              >
                Clear All Attendance
              </Button>
            </div>
          )}

          {/* Edit hasher dialog */}
          {editingHasher && (
            <HasherForm
              open={true}
              onClose={handleEditClose}
              kennelId={kennelId}
              kennelSlug={kennelSlug}
              hasher={editingHasher}
            />
          )}

          {/* Clear All Confirmation Dialog */}
          <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear all attendance?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete{" "}
                  <strong>
                    {records.length} attendance record
                    {records.length !== 1 ? "s" : ""}
                  </strong>{" "}
                  for{" "}
                  <strong>
                    {selectedEvent?.kennelShortName}
                    {selectedEvent?.runNumber
                      ? ` #${selectedEvent.runNumber}`
                      : ""}
                    {selectedEvent?.title ? ` — ${selectedEvent.title}` : ""}
                  </strong>
                  . This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isPending}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={executeClear}
                  disabled={isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isPending ? "Clearing..." : "Clear All"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
