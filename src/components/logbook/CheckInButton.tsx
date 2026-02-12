"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { checkIn, rsvp, confirmAttendance } from "@/app/logbook/actions";
import { AttendanceBadge } from "./AttendanceBadge";
import { EditAttendanceDialog } from "./EditAttendanceDialog";

export interface AttendanceData {
  id: string;
  participationLevel: string;
  status: string; // "INTENDING" | "CONFIRMED"
  stravaUrl: string | null;
  notes: string | null;
}

interface CheckInButtonProps {
  eventId: string;
  eventDate: string; // ISO string
  isAuthenticated: boolean;
  attendance: AttendanceData | null;
}

export function CheckInButton({
  eventId,
  eventDate,
  isAuthenticated,
  attendance,
}: CheckInButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const router = useRouter();

  // Determine if event is in the past (client-side check)
  const now = new Date();
  const todayUtcNoon = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12, 0, 0,
  );
  const eventTime = new Date(eventDate).getTime();
  const isPast = eventTime < todayUtcNoon;

  // Not authenticated
  if (!isAuthenticated) {
    return isPast ? (
      <Link
        href="/sign-in"
        className="text-sm text-primary hover:underline"
      >
        Sign in to check in
      </Link>
    ) : (
      <Link
        href="/sign-in"
        className="text-sm text-primary hover:underline"
      >
        Sign in to RSVP
      </Link>
    );
  }

  // ── PAST EVENT ──

  if (isPast) {
    // INTENDING → show "Confirm" button to upgrade
    if (attendance?.status === "INTENDING") {
      const attendanceId = attendance.id;
      function handleConfirm() {
        startTransition(async () => {
          const result = await confirmAttendance(attendanceId);
          if (result.error) {
            toast.error(result.error);
          } else {
            toast.success("Attendance confirmed!");
          }
          router.refresh();
        });
      }

      return (
        <Button
          size="sm"
          onClick={handleConfirm}
          disabled={isPending}
        >
          {isPending ? "..." : "Confirm"}
        </Button>
      );
    }

    // CONFIRMED → show badge + edit dialog
    if (attendance?.status === "CONFIRMED") {
      return (
        <>
          <AttendanceBadge
            level={attendance.participationLevel}
            onClick={() => setEditOpen(true)}
          />
          <EditAttendanceDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            attendance={attendance}
          />
        </>
      );
    }

    // No attendance → "I Was There"
    function handleCheckIn() {
      startTransition(async () => {
        const result = await checkIn(eventId);
        if (result.error) {
          toast.error(result.error);
        } else {
          toast.success("Checked in!");
        }
        router.refresh();
      });
    }

    return (
      <Button
        size="sm"
        onClick={handleCheckIn}
        disabled={isPending}
      >
        {isPending ? "..." : "I Was There"}
      </Button>
    );
  }

  // ── FUTURE EVENT ──

  // Already going → show "Going" badge (click to toggle off)
  if (attendance?.status === "INTENDING") {
    function handleUnrsvp() {
      startTransition(async () => {
        const result = await rsvp(eventId);
        if (result.error) {
          toast.error(result.error);
        } else {
          toast("RSVP removed");
        }
        router.refresh();
      });
    }

    return (
      <Button
        size="sm"
        variant="outline"
        className="border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
        onClick={handleUnrsvp}
        disabled={isPending}
      >
        {isPending ? "..." : "Going"}
      </Button>
    );
  }

  // Not going → "I'm Going" button
  function handleRsvp() {
    startTransition(async () => {
      const result = await rsvp(eventId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("You're going!");
      }
      router.refresh();
    });
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleRsvp}
      disabled={isPending}
    >
      {isPending ? "..." : "I'm Going"}
    </Button>
  );
}
