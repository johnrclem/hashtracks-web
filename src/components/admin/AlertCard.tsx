"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  acknowledgeAlert,
  snoozeAlert,
  resolveAlert,
  rescrapeFromAlert,
  createIssueFromAlert,
} from "@/app/admin/alerts/actions";
import { AlertContextDisplay } from "./AlertContextDisplay";
import { UnmatchedTagResolver } from "./UnmatchedTagResolver";
import type { KennelOption } from "./UnmatchedTagResolver";

export interface AlertData {
  id: string;
  sourceId: string;
  type: string;
  severity: string;
  title: string;
  details: string | null;
  context: Record<string, unknown> | null;
  repairLog: RepairLogEntry[] | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  snoozedUntil: string | null;
  sourceName: string;
}

interface RepairLogEntry {
  action: string;
  timestamp: string;
  adminId: string;
  details: Record<string, unknown>;
  result: "success" | "error";
  resultMessage?: string;
}

interface AlertCardProps {
  alert: AlertData;
  allKennels?: { id: string; shortName: string }[];
  suggestions?: Record<string, KennelOption[]>;
}

const TYPE_LABELS: Record<string, string> = {
  EVENT_COUNT_ANOMALY: "Count Drop",
  FIELD_FILL_DROP: "Field Quality",
  STRUCTURE_CHANGE: "Format Change",
  SCRAPE_FAILURE: "Scrape Failed",
  CONSECUTIVE_FAILURES: "Repeated Failures",
  UNMATCHED_TAGS: "New Tags",
  SOURCE_KENNEL_MISMATCH: "Kennel Mismatch",
};

const SEVERITY_STYLES: Record<
  string,
  { border: string; badge: "default" | "secondary" | "destructive" | "outline" }
> = {
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

const REPAIR_LABELS: Record<string, string> = {
  rescrape: "Re-scraped",
  create_alias: "Created alias",
  create_kennel: "Created kennel",
  create_issue: "Filed issue",
  link_kennel: "Linked kennel",
};

function formatRepairEntry(entry: RepairLogEntry): string {
  const label = REPAIR_LABELS[entry.action] ?? entry.action;
  const d = entry.details;
  switch (entry.action) {
    case "create_alias":
      return `${label}: "${String(d.tag ?? "")}" → ${String(d.kennelName ?? "")}`;
    case "create_kennel":
      return `${label}: ${String(d.shortName ?? "")}`;
    case "rescrape":
      return `${label}: ${String(d.eventsFound ?? 0)} found, ${String(d.created ?? 0)} created`;
    case "create_issue":
      return `${label}: #${String(d.issueNumber ?? "")}`;
    case "link_kennel":
      return `${label}: "${String(d.tag ?? "")}" → ${String(d.kennelName ?? "")}`;
    default:
      return label;
  }
}

export function AlertCard({ alert, allKennels, suggestions }: AlertCardProps) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();

  const style = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.INFO;
  const isActive = alert.status === "OPEN" || alert.status === "ACKNOWLEDGED";
  const ctx = alert.context;
  const repairLog = Array.isArray(alert.repairLog)
    ? (alert.repairLog as RepairLogEntry[])
    : null;

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

  function handleRescrape() {
    startTransition(async () => {
      const result = await rescrapeFromAlert(alert.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(
          `Re-scraped: ${result.eventsFound} found, ${result.created} created, ${result.updated} updated`,
        );
      }
      router.refresh();
    });
  }

  function handleFileIssue() {
    startTransition(async () => {
      const result = await createIssueFromAlert(alert.id);
      if (result.error) {
        toast.error(result.error);
      } else if (result.issueUrl) {
        toast.success("GitHub issue created", {
          action: {
            label: "View",
            onClick: () => window.open(result.issueUrl, "_blank"),
          },
        });
      }
      router.refresh();
    });
  }

  return (
    <div className={`rounded-md border bg-card p-4 ${style.border}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={style.badge}>{alert.severity}</Badge>
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
            <Badge variant="outline" className="text-xs">
              Acknowledged
            </Badge>
          )}
          {alert.status === "SNOOZED" && (
            <Badge variant="outline" className="text-xs">
              Snoozed
              {alert.snoozedUntil
                ? ` until ${new Date(alert.snoozedUntil).toLocaleDateString()}`
                : ""}
            </Badge>
          )}
          {alert.status === "RESOLVED" && (
            <Badge
              variant="outline"
              className="text-xs text-muted-foreground"
            >
              Resolved
            </Badge>
          )}
        </div>
      </div>

      {/* Title */}
      <p className="mt-2 text-sm font-medium">{alert.title}</p>

      {/* Expandable context/details */}
      {(ctx || alert.details) && (
        <div className="mt-1">
          {expanded ? (
            <>
              {/* UNMATCHED_TAGS: show resolver UI */}
              {alert.type === "UNMATCHED_TAGS" &&
                ctx &&
                Array.isArray(ctx.tags) &&
                allKennels ? (
                <UnmatchedTagResolver
                  alertId={alert.id}
                  tags={ctx.tags as string[]}
                  suggestions={suggestions ?? {}}
                  allKennels={allKennels}
                />
              ) : (
                <AlertContextDisplay
                  type={alert.type}
                  context={ctx}
                  details={alert.details}
                />
              )}
            </>
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

      {/* Repair history */}
      {repairLog && repairLog.length > 0 && (
        <div className="mt-2 border-t pt-2 space-y-1">
          {repairLog.slice(-3).map((entry, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-[11px] text-muted-foreground"
            >
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${entry.result === "success" ? "bg-green-500" : "bg-red-500"}`}
              />
              <span>
                {formatRepairEntry(entry)}
              </span>
              <span className="opacity-60">{timeAgo(entry.timestamp)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      {isActive && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={isPending}
                onClick={handleRescrape}
              >
                {isPending ? "..." : "Re-scrape"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Try fetching this source again — good first step for transient errors</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={isPending}
                onClick={handleFileIssue}
              >
                File Issue
              </Button>
            </TooltipTrigger>
            <TooltipContent>Create a GitHub issue with alert context for code-level investigation</TooltipContent>
          </Tooltip>
          {alert.status === "OPEN" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={isPending}
                  onClick={handleAcknowledge}
                >
                  Acknowledge
                </Button>
              </TooltipTrigger>
              <TooltipContent>Mark as seen — keeps the alert visible but signals you're aware</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={isPending}
                onClick={() => handleSnooze(24)}
              >
                Snooze 24h
              </Button>
            </TooltipTrigger>
            <TooltipContent>Hide this alert for 24 hours — it will reappear if still unresolved</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={isPending}
                onClick={() => handleSnooze(168)}
              >
                Snooze 7d
              </Button>
            </TooltipTrigger>
            <TooltipContent>Hide this alert for 7 days</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={isPending}
                onClick={handleResolve}
              >
                Resolve
              </Button>
            </TooltipTrigger>
            <TooltipContent>Mark as fixed — moves to resolved tab</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href={`/admin/sources/${alert.sourceId}`}
                className="text-xs text-primary hover:underline"
              >
                Investigate
              </Link>
            </TooltipTrigger>
            <TooltipContent>Go to source detail page for deeper investigation</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
