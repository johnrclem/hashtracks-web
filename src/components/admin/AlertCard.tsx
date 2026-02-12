"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  acknowledgeAlert,
  snoozeAlert,
  resolveAlert,
} from "@/app/admin/alerts/actions";

export interface AlertData {
  id: string;
  sourceId: string;
  type: string;
  severity: string;
  title: string;
  details: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  snoozedUntil: string | null;
  sourceName: string;
}

const TYPE_LABELS: Record<string, string> = {
  EVENT_COUNT_ANOMALY: "Count Drop",
  FIELD_FILL_DROP: "Field Quality",
  STRUCTURE_CHANGE: "Format Change",
  SCRAPE_FAILURE: "Scrape Failed",
  CONSECUTIVE_FAILURES: "Repeated Failures",
  UNMATCHED_TAGS: "New Tags",
};

const SEVERITY_STYLES: Record<string, { border: string; badge: "default" | "secondary" | "destructive" | "outline" }> = {
  CRITICAL: { border: "border-l-4 border-l-red-500", badge: "destructive" },
  WARNING: { border: "border-l-4 border-l-amber-500", badge: "secondary" },
  INFO: { border: "border-l-4 border-l-blue-500", badge: "outline" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AlertCard({ alert }: { alert: AlertData }) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();

  const style = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.INFO;

  function handleAcknowledge() {
    startTransition(async () => {
      const result = await acknowledgeAlert(alert.id);
      if (result.error) toast.error(result.error);
      else toast.success("Alert acknowledged");
      router.refresh();
    });
  }

  function handleSnooze(hours: number) {
    startTransition(async () => {
      const result = await snoozeAlert(alert.id, hours);
      if (result.error) toast.error(result.error);
      else toast.success(`Snoozed for ${hours}h`);
      router.refresh();
    });
  }

  function handleResolve() {
    startTransition(async () => {
      const result = await resolveAlert(alert.id);
      if (result.error) toast.error(result.error);
      else toast.success("Alert resolved");
      router.refresh();
    });
  }

  return (
    <div className={`rounded-md border bg-card p-4 ${style.border}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={style.badge}>
            {alert.severity}
          </Badge>
          <Badge variant="outline">
            {TYPE_LABELS[alert.type] ?? alert.type}
          </Badge>
          <Link
            href={`/admin/sources/${alert.sourceId}`}
            className="text-sm text-primary hover:underline"
          >
            {alert.sourceName}
          </Link>
          <span className="text-xs text-muted-foreground">
            {timeAgo(alert.createdAt)}
          </span>
          {alert.status === "ACKNOWLEDGED" && (
            <Badge variant="outline" className="text-xs">Acknowledged</Badge>
          )}
          {alert.status === "SNOOZED" && (
            <Badge variant="outline" className="text-xs">
              Snoozed{alert.snoozedUntil ? ` until ${new Date(alert.snoozedUntil).toLocaleDateString()}` : ""}
            </Badge>
          )}
          {alert.status === "RESOLVED" && (
            <Badge variant="outline" className="text-xs text-muted-foreground">Resolved</Badge>
          )}
        </div>
      </div>

      {/* Title */}
      <p className="mt-2 text-sm font-medium">{alert.title}</p>

      {/* Details (expandable) */}
      {alert.details && (
        <div className="mt-1">
          {expanded ? (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{alert.details}</p>
          ) : (
            <button
              onClick={() => setExpanded(true)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Show details...
            </button>
          )}
        </div>
      )}

      {/* Actions */}
      {(alert.status === "OPEN" || alert.status === "ACKNOWLEDGED") && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {alert.status === "OPEN" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={isPending}
              onClick={handleAcknowledge}
            >
              Acknowledge
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={isPending}
            onClick={() => handleSnooze(24)}
          >
            Snooze 24h
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={isPending}
            onClick={() => handleSnooze(168)}
          >
            Snooze 7d
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={isPending}
            onClick={handleResolve}
          >
            Resolve
          </Button>
          <Link
            href={`/admin/sources/${alert.sourceId}`}
            className="text-xs text-primary hover:underline"
          >
            Investigate
          </Link>
        </div>
      )}
    </div>
  );
}
