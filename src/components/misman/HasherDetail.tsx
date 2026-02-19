"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { deleteKennelHasher } from "@/app/misman/[slug]/roster/actions";
import { getAttendanceEditLog } from "@/app/misman/[slug]/attendance/actions";
import { HasherForm } from "./HasherForm";
import { UserLinkSection } from "./UserLinkSection";
import { VerificationBadge } from "./VerificationBadge";
import { EditHistoryTimeline } from "./EditHistoryTimeline";
import type { VerificationStatus } from "@/lib/misman/verification";
import type { AuditLogEntry } from "@/lib/misman/audit";

interface AttendanceEntry {
  id: string;
  eventId: string;
  date: string;
  title: string | null;
  runNumber: number | null;
  kennelShortName: string;
  paid: boolean;
  haredThisTrail: boolean;
  isVirgin: boolean;
  isVisitor: boolean;
  createdAt: string;
  verificationStatus?: VerificationStatus;
  hasEdits?: boolean;
}

interface HasherData {
  id: string;
  kennelId: string | null;
  kennelShortName: string | null;
  hashName: string | null;
  nerdName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  profileInviteToken?: string | null;
  profileInviteExpiresAt?: string | null;
  userLink: {
    id: string;
    status: string;
    userHashName: string | null;
    userEmail: string;
  } | null;
  stats: {
    totalRuns: number;
    hareCount: number;
    paidCount: number;
    firstRun: string | null;
    lastRun: string | null;
  };
  attendances: AttendanceEntry[];
}

interface HasherDetailProps {
  hasher: HasherData;
  kennelId: string;
  kennelSlug: string;
}

export function HasherDetail({ hasher, kennelId, kennelSlug }: HasherDetailProps) {
  const [showEdit, setShowEdit] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [editLogs, setEditLogs] = useState<Record<string, AuditLogEntry[]>>({});
  const router = useRouter();

  function handleToggleEditLog(attendanceId: string) {
    if (expandedLogId === attendanceId) {
      setExpandedLogId(null);
      return;
    }
    setExpandedLogId(attendanceId);
    // Lazy-load the edit log if not already fetched
    if (!editLogs[attendanceId]) {
      startTransition(async () => {
        const result = await getAttendanceEditLog(kennelId, attendanceId);
        if (result.data) {
          setEditLogs((prev) => ({ ...prev, [attendanceId]: result.data! }));
        }
      });
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "America/New_York",
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `Delete ${hasher.hashName || hasher.nerdName} from the roster? This cannot be undone.`,
      )
    )
      return;

    startTransition(async () => {
      const result = await deleteKennelHasher(hasher.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Hasher removed from roster");
        router.push(`/misman/${kennelSlug}/roster`);
      }
    });
  }

  const displayName = hasher.hashName || hasher.nerdName || "Unknown";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold">{displayName}</h2>
          {hasher.hashName && hasher.nerdName && (
            <p className="text-muted-foreground">{hasher.nerdName}</p>
          )}
          <div className="mt-1 flex items-center gap-2">
            {hasher.kennelShortName && (
              <Badge variant="outline">{hasher.kennelShortName}</Badge>
            )}
            {hasher.userLink && (
              <Badge
                variant={
                  hasher.userLink.status === "CONFIRMED"
                    ? "default"
                    : "secondary"
                }
              >
                {hasher.userLink.status === "CONFIRMED"
                  ? "Linked"
                  : hasher.userLink.status === "SUGGESTED"
                    ? "Link pending"
                    : "Link dismissed"}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowEdit(true)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={handleDelete}
            disabled={isPending}
          >
            Delete
          </Button>
        </div>
      </div>

      {/* Contact info */}
      {(hasher.email || hasher.phone || hasher.notes) && (
        <div className="rounded-lg border p-4 space-y-1 text-sm">
          {hasher.email && (
            <div>
              <span className="text-muted-foreground">Email:</span>{" "}
              {hasher.email}
            </div>
          )}
          {hasher.phone && (
            <div>
              <span className="text-muted-foreground">Phone:</span>{" "}
              {hasher.phone}
            </div>
          )}
          {hasher.notes && (
            <div>
              <span className="text-muted-foreground">Notes:</span>{" "}
              {hasher.notes}
            </div>
          )}
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Runs" value={hasher.stats.totalRuns} />
        <StatCard label="Times Hared" value={hasher.stats.hareCount} />
        <StatCard label="Times Paid" value={hasher.stats.paidCount} />
        <StatCard
          label="Hare Rate"
          value={
            hasher.stats.totalRuns > 0
              ? `${Math.round((hasher.stats.hareCount / hasher.stats.totalRuns) * 100)}%`
              : "—"
          }
        />
      </div>

      {/* Date range */}
      {hasher.stats.firstRun && hasher.stats.lastRun && (
        <div className="text-sm text-muted-foreground">
          First run: {formatDate(hasher.stats.firstRun)} · Last run:{" "}
          {formatDate(hasher.stats.lastRun)}
        </div>
      )}

      {/* User linking */}
      <UserLinkSection
        kennelId={kennelId}
        kennelHasherId={hasher.id}
        userLink={hasher.userLink ? {
          id: hasher.userLink.id,
          status: hasher.userLink.status,
          userHashName: hasher.userLink.userHashName,
          userEmail: hasher.userLink.userEmail,
        } : null}
        hasherDisplayName={displayName}
        invite={{
          token: hasher.profileInviteToken ?? null,
          expiresAt: hasher.profileInviteExpiresAt ?? null,
        }}
      />

      {/* Attendance history */}
      <div>
        <h3 className="mb-3 font-semibold">
          Attendance History ({hasher.attendances.length})
        </h3>
        {hasher.attendances.length === 0 ? (
          <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
            No attendance recorded yet.
          </div>
        ) : (
          <div className="space-y-1">
            {hasher.attendances.map((a) => (
              <div key={a.id}>
                <div className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {a.runNumber ? `#${a.runNumber}` : ""}
                        {a.runNumber && a.title ? " — " : ""}
                        {a.title || (a.runNumber ? "" : "Untitled")}
                      </span>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {a.kennelShortName}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(a.date)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {a.hasEdits && (
                      <button
                        type="button"
                        onClick={() => handleToggleEditLog(a.id)}
                        className="text-muted-foreground hover:text-foreground p-0.5"
                        title="View edit history"
                      >
                        <History className="h-3 w-3" />
                      </button>
                    )}
                    {a.verificationStatus && a.verificationStatus !== "none" && (
                      <VerificationBadge status={a.verificationStatus} />
                    )}
                    {a.paid && (
                      <span className="text-xs text-green-600" title="Paid">
                        $
                      </span>
                    )}
                    {a.haredThisTrail && (
                      <span className="text-xs text-orange-600" title="Hare">
                        H
                      </span>
                    )}
                    {a.isVirgin && (
                      <span className="text-xs text-purple-600" title="Virgin">
                        V
                      </span>
                    )}
                    {a.isVisitor && (
                      <span className="text-xs text-blue-600" title="Visitor">
                        Vis
                      </span>
                    )}
                  </div>
                </div>
                {expandedLogId === a.id && (
                  <div className="ml-4 mt-1 mb-2 pl-3 border-l-2">
                    {editLogs[a.id] ? (
                      <EditHistoryTimeline log={editLogs[a.id]} />
                    ) : (
                      <p className="text-xs text-muted-foreground">Loading...</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Added to roster date */}
      <div className="text-xs text-muted-foreground">
        Added to roster: {formatDate(hasher.createdAt)}
      </div>

      {/* Edit dialog */}
      <HasherForm
        open={showEdit}
        onClose={() => setShowEdit(false)}
        kennelId={kennelId}
        kennelSlug={kennelSlug}
        hasher={{
          id: hasher.id,
          hashName: hasher.hashName,
          nerdName: hasher.nerdName,
          email: hasher.email,
          phone: hasher.phone,
          notes: hasher.notes,
        }}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
