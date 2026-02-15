"use client";

import type { AuditLogEntry } from "@/lib/misman/audit";

interface EditHistoryTimelineProps {
  log: AuditLogEntry[];
}

const ACTION_LABELS: Record<string, string> = {
  record: "Recorded",
  update: "Updated",
  remove: "Removed",
  clear: "Cleared",
  import: "Imported",
  hare_sync: "Hare synced",
};

const FIELD_LABELS: Record<string, string> = {
  paid: "Paid",
  haredThisTrail: "Hare",
  isVirgin: "Virgin",
  isVisitor: "Visitor",
  visitorLocation: "Visitor location",
  referralSource: "Referral source",
  referralOther: "Referral other",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export function EditHistoryTimeline({ log }: EditHistoryTimelineProps) {
  if (log.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No edit history available.</p>
    );
  }

  return (
    <div className="space-y-3">
      {log.map((entry, i) => (
        <div key={i} className="relative pl-4 border-l-2 border-muted pb-2">
          <div className="absolute -left-1 top-1 h-2 w-2 rounded-full bg-muted-foreground" />
          <div className="text-xs text-muted-foreground">
            {formatTimestamp(entry.timestamp)}
          </div>
          <div className="text-sm font-medium">
            {ACTION_LABELS[entry.action] || entry.action}
          </div>
          {entry.changes && (
            <div className="mt-1 space-y-0.5">
              {Object.entries(entry.changes).map(([field, change]) => (
                <div key={field} className="text-xs text-muted-foreground">
                  {FIELD_LABELS[field] || field}:{" "}
                  <span className="line-through">{formatValue(change.old)}</span>
                  {" \u2192 "}
                  <span className="font-medium text-foreground">
                    {formatValue(change.new)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {entry.details && Object.keys(entry.details).length > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              {Object.entries(entry.details).map(([key, val]) => (
                <span key={key} className="mr-2">
                  {key}: {formatValue(val)}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
