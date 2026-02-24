"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KennelTagInput, type KennelOption } from "./KennelTagInput";

export interface StaticScheduleConfig {
  kennelTag?: string;
  rrule?: string;
  startTime?: string;
  defaultTitle?: string;
  defaultLocation?: string;
  defaultDescription?: string;
}

interface StaticScheduleConfigPanelProps {
  readonly config: StaticScheduleConfig | null;
  readonly onChange: (config: StaticScheduleConfig) => void;
  readonly allKennels?: KennelOption[];
}

export function StaticScheduleConfigPanel({
  config,
  onChange,
  allKennels,
}: StaticScheduleConfigPanelProps) {
  const current = config ?? {};

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="ss-kennel-tag">Kennel Tag *</Label>
        <KennelTagInput
          id="ss-kennel-tag"
          value={current.kennelTag ?? ""}
          onChange={(v) =>
            onChange({ ...current, kennelTag: v || undefined })
          }
          allKennels={allKennels}
          placeholder="e.g. Rumson"
        />
        <p className="text-xs text-muted-foreground">
          All generated events are assigned to this kennel shortName.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ss-rrule">Recurrence Rule (RRULE) *</Label>
        <Input
          id="ss-rrule"
          value={current.rrule ?? ""}
          onChange={(e) =>
            onChange({ ...current, rrule: e.target.value || undefined })
          }
          placeholder="FREQ=WEEKLY;BYDAY=SA"
        />
        <p className="text-xs text-muted-foreground">
          RFC 5545 RRULE string. Examples:{" "}
          <code className="rounded bg-muted px-1">FREQ=WEEKLY;BYDAY=SA</code>{" "}
          (every Saturday),{" "}
          <code className="rounded bg-muted px-1">FREQ=WEEKLY;INTERVAL=2;BYDAY=SA</code>{" "}
          (biweekly),{" "}
          <code className="rounded bg-muted px-1">FREQ=MONTHLY;BYDAY=2SA</code>{" "}
          (2nd Saturday of month).
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ss-start-time">Start Time</Label>
        <Input
          id="ss-start-time"
          value={current.startTime ?? ""}
          onChange={(e) =>
            onChange({ ...current, startTime: e.target.value || undefined })
          }
          placeholder="10:17 AM"
        />
        <p className="text-xs text-muted-foreground">
          12-hour (e.g. &quot;10:17 AM&quot;) or 24-hour (e.g. &quot;10:17&quot;) format.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ss-title">Default Title</Label>
        <Input
          id="ss-title"
          value={current.defaultTitle ?? ""}
          onChange={(e) =>
            onChange({ ...current, defaultTitle: e.target.value || undefined })
          }
          placeholder="e.g. Rumson H3 Weekly Run"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ss-location">Default Location</Label>
        <Input
          id="ss-location"
          value={current.defaultLocation ?? ""}
          onChange={(e) =>
            onChange({ ...current, defaultLocation: e.target.value || undefined })
          }
          placeholder="e.g. Rumson, NJ"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ss-description">Default Description</Label>
        <Input
          id="ss-description"
          value={current.defaultDescription ?? ""}
          onChange={(e) =>
            onChange({
              ...current,
              defaultDescription: e.target.value || undefined,
            })
          }
          placeholder="e.g. Check Facebook for start location and hare details."
        />
      </div>
    </div>
  );
}
