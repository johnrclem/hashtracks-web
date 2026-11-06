import { AlertTriangle, Bot } from "lucide-react";

import { formatRelativeTime } from "@/lib/format";
import type { AuditAutomationHeartbeat } from "@/app/admin/audit/actions";

/**
 * One-line health signal for the scheduled deep-dive agent. Healthy shows a
 * quiet line. Stale, never-run, or a failed probe shows an amber box, so a
 * stopped agent is obvious on the dashboard instead of going unnoticed.
 */
export function AuditAutomationHeartbeatBanner({
  heartbeat,
}: Readonly<{
  /** Result of `getAuditAutomationHeartbeat`; null when the probe failed. */
  heartbeat: AuditAutomationHeartbeat | null;
}>) {
  if (heartbeat && !heartbeat.stale && heartbeat.lastDeepDiveAt) {
    return (
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Bot className="h-4 w-4 text-emerald-500" />
        Agent deep dives: last {formatRelativeTime(heartbeat.lastDeepDiveAt)},{" "}
        {heartbeat.deepDivesLast24h} in the last 24h.
      </div>
    );
  }

  let message: string;
  if (heartbeat === null) {
    message = "Deep-dive automation status unavailable: the heartbeat probe failed.";
  } else if (heartbeat.lastDeepDiveAt === null) {
    message = "The scheduled audit agent has not recorded a deep dive yet.";
  } else {
    message = `No agent deep dive since ${formatRelativeTime(heartbeat.lastDeepDiveAt)} (warning after ${heartbeat.staleAfterHours}h). The scheduled audit agent may have stopped.`;
  }

  return (
    <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/[0.08] p-3">
      <div className="flex items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <span>{message}</span>
      </div>
    </div>
  );
}
