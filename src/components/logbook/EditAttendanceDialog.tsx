"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { updateAttendance, deleteAttendance } from "@/app/logbook/actions";
import {
  participationLevelLabel,
  PARTICIPATION_LEVELS,
} from "@/lib/format";
import type { AttendanceData } from "./CheckInButton";

interface EditAttendanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attendance: AttendanceData;
}

export function EditAttendanceDialog({
  open,
  onOpenChange,
  attendance,
}: EditAttendanceDialogProps) {
  const [level, setLevel] = useState(attendance.participationLevel);
  const [activityUrl, setActivityUrl] = useState(attendance.stravaUrl ?? "");
  const [notes, setNotes] = useState(attendance.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSave() {
    startTransition(async () => {
      const result = await updateAttendance(attendance.id, {
        participationLevel: level,
        stravaUrl: activityUrl || null,
        notes: notes || null,
      });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Attendance updated");
        onOpenChange(false);
      }
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startTransition(async () => {
      const result = await deleteAttendance(attendance.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Check-in removed");
        onOpenChange(false);
      }
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => {
      onOpenChange(v);
      if (!v) setConfirmDelete(false);
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Check-in</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="level">Participation Level</Label>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger id="level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PARTICIPATION_LEVELS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {participationLevelLabel(l)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="activity-url">Activity Link</Label>
            <Input
              id="activity-url"
              type="url"
              placeholder="https://www.strava.com/activities/..."
              value={activityUrl}
              onChange={(e) => setActivityUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Strava, Garmin, AllTrails, or any activity URL
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Trail notes, memorable moments..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={isPending}
          >
            {confirmDelete ? "Confirm Remove" : "Remove Check-in"}
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
