"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { checkIn } from "@/app/logbook/actions";
import { AttendanceBadge } from "./AttendanceBadge";
import { EditAttendanceDialog } from "./EditAttendanceDialog";

export interface AttendanceData {
  id: string;
  participationLevel: string;
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

  // Hide for future events (client-side check)
  const now = new Date();
  const todayUtcNoon = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12, 0, 0,
  );
  const eventTime = new Date(eventDate).getTime();
  if (eventTime >= todayUtcNoon) return null;

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <Link
        href="/sign-in"
        className="text-sm text-primary hover:underline"
      >
        Sign in to check in
      </Link>
    );
  }

  // Already checked in — show badge that opens edit dialog
  if (attendance) {
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

  // Not checked in — show "I Was There" button
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
