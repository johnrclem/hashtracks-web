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

/** Render the check-in button for a past event. */
function PastEventButton({
  eventId,
  attendance,
}: {
  eventId: string;
  attendance: AttendanceData | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const router = useRouter();

  if (attendance?.status === "INTENDING") {
    const attendanceId = attendance.id;
    return (
      <Button
        size="sm"
        onClick={() => {
          startTransition(async () => {
            const result = await confirmAttendance(attendanceId);
            if (!result.success) toast.error(result.error);
            else toast.success("Attendance confirmed!");
            router.refresh();
          });
        }}
        disabled={isPending}
      >
        {isPending ? "..." : "Confirm"}
      </Button>
    );
  }

  if (attendance?.status === "CONFIRMED") {
    return (
      <>
        <AttendanceBadge level={attendance.participationLevel} onClick={() => setEditOpen(true)} />
        <EditAttendanceDialog open={editOpen} onOpenChange={setEditOpen} attendance={attendance} />
      </>
    );
  }

  return (
    <Button
      size="sm"
      onClick={() => {
        startTransition(async () => {
          const result = await checkIn(eventId);
          if (!result.success) toast.error(result.error);
          else toast.success("Checked in!");
          router.refresh();
        });
      }}
      disabled={isPending}
    >
      {isPending ? "..." : "I Was There"}
    </Button>
  );
}

/** Render the RSVP button for a future event. */
function FutureEventButton({
  eventId,
  attendance,
}: {
  eventId: string;
  attendance: AttendanceData | null;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (attendance?.status === "INTENDING") {
    return (
      <Button
        size="sm"
        variant="outline"
        className="border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
        onClick={() => {
          startTransition(async () => {
            const result = await rsvp(eventId);
            if (!result.success) toast.error(result.error);
            else toast("RSVP removed");
            router.refresh();
          });
        }}
        disabled={isPending}
      >
        {isPending ? "..." : "Going"}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        startTransition(async () => {
          const result = await rsvp(eventId);
          if (!result.success) toast.error(result.error);
          else toast.success("You're going!");
          router.refresh();
        });
      }}
      disabled={isPending}
    >
      {isPending ? "..." : "I'm Going"}
    </Button>
  );
}

export function CheckInButton({
  eventId,
  eventDate,
  isAuthenticated,
  attendance,
}: CheckInButtonProps) {
  const now = new Date();
  const todayUtcNoon = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);
  const eventTime = new Date(eventDate).getTime();
  const isPast = eventTime <= todayUtcNoon;

  if (!isAuthenticated) {
    const label = isPast ? "Sign in to check in" : "Sign in to RSVP";
    return (
      <Link href="/sign-in" className="text-sm text-primary hover:underline">
        {label}
      </Link>
    );
  }

  if (isPast) {
    return <PastEventButton eventId={eventId} attendance={attendance} />;
  }

  return <FutureEventButton eventId={eventId} attendance={attendance} />;
}
