"use client";

import { useState, useTransition, useEffect } from "react";
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
  getStravaActivitiesForDate,
  attachStravaActivity,
} from "@/app/strava/actions";
import {
  participationLevelLabel,
  PARTICIPATION_LEVELS,
} from "@/lib/format";
import type { AttendanceData } from "./CheckInButton";
import type { StravaActivityOption } from "@/lib/strava/types";

interface EditAttendanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attendance: AttendanceData;
  eventDate?: string; // ISO string — needed for Strava activity lookup
  stravaConnected?: boolean; // Whether user has Strava connected
}

export function EditAttendanceDialog({
  open,
  onOpenChange,
  attendance,
  eventDate,
  stravaConnected,
}: EditAttendanceDialogProps) {
  const [level, setLevel] = useState(attendance.participationLevel);
  const [activityUrl, setActivityUrl] = useState(attendance.stravaUrl ?? "");
  const [notes, setNotes] = useState(attendance.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Strava activity picker state
  const [stravaActivities, setStravaActivities] = useState<StravaActivityOption[]>([]);
  const [stravaLoading, setStravaLoading] = useState(false);

  // Load Strava activities when dialog opens (if user has Strava connected)
  useEffect(() => {
    if (!open || !stravaConnected || !eventDate) return;
    const dateStr = eventDate.substring(0, 10); // "YYYY-MM-DD" from ISO
    setStravaLoading(true);
    getStravaActivitiesForDate(dateStr).then((result) => {
      setStravaLoading(false);
      if (result.success) {
        setStravaActivities(result.activities);
      }
    });
  }, [open, stravaConnected, eventDate]);

  function handleStravaSelect(activity: StravaActivityOption) {
    startTransition(async () => {
      const result = await attachStravaActivity(activity.id, attendance.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      // Update the URL field to show the attached activity
      const url = `https://www.strava.com/activities/${activity.stravaActivityId}`;
      setActivityUrl(url);
      // Remove from available list
      setStravaActivities((prev) => prev.filter((a) => a.id !== activity.id));
      toast.success("Strava activity linked");
      router.refresh();
    });
  }

  function formatDistance(meters: number): string {
    const miles = meters / 1609.344;
    return `${miles.toFixed(1)} mi`;
  }

  function formatDuration(secs: number): string {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateAttendance(attendance.id, {
        participationLevel: level,
        stravaUrl: activityUrl || null,
        notes: notes || null,
      });
      if (!result.success) {
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
      if (!result.success) {
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

          {/* Strava activity picker (only when connected + activities available) */}
          {stravaConnected && (
            <div className="space-y-2">
              <Label>Pick from Strava</Label>
              {stravaLoading ? (
                <p className="text-xs text-muted-foreground">Loading activities...</p>
              ) : stravaActivities.length > 0 ? (
                <div className="space-y-1">
                  {stravaActivities.map((activity) => (
                    <button
                      key={activity.id}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                      disabled={isPending}
                      onClick={() => handleStravaSelect(activity)}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {activity.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDistance(activity.distanceMeters)}
                        {activity.movingTimeSecs > 0 && ` · ${formatDuration(activity.movingTimeSecs)}`}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No unmatched activities found for this date
                </p>
              )}
            </div>
          )}

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
              {stravaConnected
                ? "Or paste any activity URL manually"
                : "Strava, Garmin, AllTrails, or any activity URL"}
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
