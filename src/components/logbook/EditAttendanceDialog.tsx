"use client";
/* eslint-disable react-hooks/set-state-in-effect */

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
  getLinkedStravaActivity,
  detachStravaActivity,
} from "@/app/strava/actions";
import {
  participationLevelLabel,
  PARTICIPATION_LEVELS,
} from "@/lib/format";
import { buildStravaUrl } from "@/lib/strava/url";
import { ExternalLink } from "lucide-react";
import { StravaActivitySummary } from "./StravaActivitySummary";
import type { AttendanceData } from "./CheckInButton";
import type { StravaActivityOption, LinkedStravaActivity } from "@/lib/strava/types";

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
  const [linkedActivity, setLinkedActivity] = useState<LinkedStravaActivity | null>(null);
  const [linkedLoading, setLinkedLoading] = useState(false);

  // Load Strava activities when dialog opens — skip if already linked
  useEffect(() => {
    if (!open || !stravaConnected || !eventDate || attendance.stravaUrl) return;
    const dateStr = eventDate.substring(0, 10); // "YYYY-MM-DD" from ISO
    setStravaLoading(true);
    getStravaActivitiesForDate(dateStr).then((result) => {
      setStravaLoading(false);
      if (result.success) {
        setStravaActivities(result.activities);
      }
    });
  }, [open, stravaConnected, eventDate, attendance.stravaUrl]);

  // Load linked Strava activity when dialog opens (if attendance has a stravaUrl)
  useEffect(() => {
    if (!open || !stravaConnected || !attendance.stravaUrl) return;
    setLinkedLoading(true);
    getLinkedStravaActivity(attendance.id).then((result) => {
      setLinkedLoading(false);
      if (result.success) {
        setLinkedActivity(result.activity ?? null);
      }
    });
  }, [open, stravaConnected, attendance.stravaUrl, attendance.id]);

  function handleStravaSelect(activity: StravaActivityOption) {
    startTransition(async () => {
      const result = await attachStravaActivity(activity.id, attendance.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setActivityUrl(buildStravaUrl(activity.stravaActivityId));
      setStravaActivities((prev) => prev.filter((a) => a.id !== activity.id));
      setLinkedActivity({
        name: activity.name,
        sportType: activity.sportType,
        distanceMeters: activity.distanceMeters,
        movingTimeSecs: activity.movingTimeSecs,
        timeLocal: activity.timeLocal,
        city: activity.city,
        stravaActivityId: activity.stravaActivityId,
      });
      toast.success("Strava activity linked");
      router.refresh();
    });
  }

  function handleDetach() {
    startTransition(async () => {
      const result = await detachStravaActivity(attendance.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setLinkedActivity(null);
      setActivityUrl("");
      // Re-fetch available activities since the detached one is now available
      if (eventDate) {
        const dateStr = eventDate.substring(0, 10);
        const refreshed = await getStravaActivitiesForDate(dateStr);
        if (refreshed.success) setStravaActivities(refreshed.activities);
      }
      toast.success("Strava activity unlinked");
      router.refresh();
    });
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

  function renderStravaContent() {
    if (linkedActivity) {
      return (
        <>
          <div className="flex items-start gap-2 rounded-md border border-strava/30 bg-strava/5 px-3 py-2 text-sm">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <StravaActivitySummary activity={linkedActivity} />
            </div>
            <div className="flex shrink-0 items-start gap-1">
              <a
                href={buildStravaUrl(linkedActivity.stravaActivityId)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 text-strava hover:text-strava-hover transition-colors"
                title="View in Strava"
              >
                <ExternalLink size={14} />
              </a>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-muted-foreground"
            onClick={handleDetach}
            disabled={isPending}
          >
            Remove Link
          </Button>
        </>
      );
    }

    if (linkedLoading) {
      return <p className="text-xs text-muted-foreground">Loading activity...</p>;
    }

    return (
      <>
        <p className="text-xs font-medium text-muted-foreground">Pick from Strava</p>
        {stravaLoading ? (
          <p className="text-xs text-muted-foreground">Loading activities...</p>
        ) : stravaActivities.length > 0 ? (
          <div className="space-y-1">
            {stravaActivities.map((activity) => (
              <div
                key={activity.id}
                className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${isPending ? "opacity-60" : "hover:bg-muted"}`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col gap-0.5 text-left disabled:opacity-50"
                  disabled={isPending}
                  onClick={() => handleStravaSelect(activity)}
                >
                  <StravaActivitySummary activity={activity} />
                </button>
                <a
                  href={buildStravaUrl(activity.stravaActivityId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`mt-0.5 shrink-0 text-strava hover:text-strava-hover transition-colors ${isPending ? "pointer-events-none opacity-50" : ""}`}
                  title="View in Strava"
                  aria-label={`View ${activity.name} in Strava`}
                >
                  <ExternalLink size={14} />
                </a>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No unmatched activities found for this date
          </p>
        )}
      </>
    );
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

          {/* Strava activity section (linked card OR picker) */}
          {stravaConnected && (
            <div className="space-y-2">
              <Label>Strava Activity</Label>
              {renderStravaContent()}
            </div>
          )}

          {!linkedActivity && (
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
          )}

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
