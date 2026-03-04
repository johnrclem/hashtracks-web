"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  startRegionResearch,
  rejectProposal,
  bulkRejectProposals,
} from "@/app/admin/research/actions";
import { ProposalApprovalDialog } from "./ProposalApprovalDialog";
import { TYPE_LABELS } from "./SourceTable";
import type { SourceType, ProposalStatus } from "@/generated/prisma/client";

export interface SerializedProposal {
  id: string;
  regionId: string;
  regionName: string;
  regionAbbrev: string;
  kennelId: string | null;
  kennelName: string | null;
  url: string;
  sourceName: string | null;
  discoveryMethod: string;
  detectedType: SourceType | null;
  extractedConfig: unknown;
  confidence: string | null;
  explanation: string | null;
  status: ProposalStatus;
  createdSourceId: string | null;
  createdAt: string;
}

interface Props {
  regions: { id: string; name: string; abbrev: string; country: string }[];
  proposals: SerializedProposal[];
  coverageGaps: Record<string, { id: string; shortName: string; website: string | null }[]>;
  statusCounts: { pending: number; approved: number; rejected: number; error: number; total: number };
}

type StatusFilter = "PENDING" | "APPROVED" | "REJECTED" | "ERROR" | "ALL";

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "text-green-600",
  medium: "text-yellow-600",
  low: "text-red-600",
};

export function ResearchDashboard({ regions, proposals, coverageGaps, statusCounts }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedRegionId, setSelectedRegionId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("PENDING");
  const [selectedProposal, setSelectedProposal] = useState<SerializedProposal | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const gaps = selectedRegionId ? (coverageGaps[selectedRegionId] ?? []) : [];

  const filteredProposals = proposals.filter((p) => {
    if (selectedRegionId && p.regionId !== selectedRegionId) return false;
    if (statusFilter !== "ALL" && p.status !== statusFilter) return false;
    return true;
  });

  function handleResearch() {
    if (!selectedRegionId) {
      toast.error("Select a region first");
      return;
    }
    startTransition(async () => {
      const result = await startRegionResearch(selectedRegionId);
      if ("error" in result && result.error) {
        toast.error(result.error);
      } else if ("success" in result) {
        toast.success(
          `Research complete: ${result.urlsDiscovered} URLs found, ${result.proposalsCreated} proposals created`,
        );
        router.refresh();
      }
    });
  }

  function handleReject(id: string) {
    startTransition(async () => {
      const result = await rejectProposal(id);
      if ("error" in result && result.error) {
        toast.error(result.error);
      } else {
        toast.success("Proposal rejected");
        router.refresh();
      }
    });
  }

  function handleBulkReject() {
    if (selectedIds.size === 0) return;
    startTransition(async () => {
      const result = await bulkRejectProposals([...selectedIds]);
      if ("error" in result && result.error) {
        toast.error(result.error);
      } else {
        toast.success(`${selectedIds.size} proposals rejected`);
        setSelectedIds(new Set());
        router.refresh();
      }
    });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredProposals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProposals.map((p) => p.id)));
    }
  }

  return (
    <div className="space-y-6">
      {/* Region selector + research button */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={selectedRegionId} onValueChange={setSelectedRegionId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select region..." />
          </SelectTrigger>
          <SelectContent>
            {regions.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          onClick={handleResearch}
          disabled={!selectedRegionId || isPending}
        >
          {isPending ? "Researching..." : "Research Region"}
        </Button>
      </div>

      {/* Coverage gaps */}
      {selectedRegionId && gaps.length > 0 && (
        <div className="rounded-md border p-4">
          <p className="text-sm font-medium mb-2">
            Coverage Gaps: {gaps.length} kennel{gaps.length !== 1 ? "s" : ""} without sources
          </p>
          <div className="flex flex-wrap gap-2">
            {gaps.map((k) => (
              <Tooltip key={k.id}>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={`text-xs ${k.website ? "border-primary/40" : ""}`}
                  >
                    {k.shortName}
                    {k.website && (
                      <span className="ml-1 text-primary">*</span>
                    )}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  {k.website ? `Has website: ${k.website}` : "No website known"}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
          {gaps.some((k) => k.website) && (
            <p className="text-xs text-muted-foreground mt-2">
              * = has website URL
            </p>
          )}
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Tabs
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as StatusFilter)}
        >
          <TabsList>
            <TabsTrigger value="PENDING">
              Pending{statusCounts.pending > 0 && ` (${statusCounts.pending})`}
            </TabsTrigger>
            <TabsTrigger value="APPROVED">
              Approved{statusCounts.approved > 0 && ` (${statusCounts.approved})`}
            </TabsTrigger>
            <TabsTrigger value="REJECTED">
              Rejected{statusCounts.rejected > 0 && ` (${statusCounts.rejected})`}
            </TabsTrigger>
            <TabsTrigger value="ERROR">
              Error{statusCounts.error > 0 && ` (${statusCounts.error})`}
            </TabsTrigger>
            <TabsTrigger value="ALL">
              All ({statusCounts.total})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {statusFilter === "PENDING" && selectedIds.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBulkReject}
            disabled={isPending}
          >
            Reject Selected ({selectedIds.size})
          </Button>
        )}
      </div>

      {/* Proposals table */}
      {filteredProposals.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {statusFilter === "PENDING"
            ? "No pending proposals. Select a region and click Research to discover sources."
            : "No proposals match this filter."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {statusFilter === "PENDING" && (
                <TableHead className="w-8">
                  <Checkbox
                    checked={selectedIds.size === filteredProposals.length && filteredProposals.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
              )}
              <TableHead>URL</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="hidden sm:table-cell">Kennel</TableHead>
              <TableHead className="hidden md:table-cell">Region</TableHead>
              <TableHead className="hidden sm:table-cell">Confidence</TableHead>
              <TableHead className="hidden lg:table-cell">Method</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProposals.map((p) => (
              <TableRow key={p.id}>
                {statusFilter === "PENDING" && (
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(p.id)}
                      onCheckedChange={() => toggleSelect(p.id)}
                    />
                  </TableCell>
                )}
                <TableCell className="max-w-[200px] sm:max-w-xs truncate">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                    title={p.url}
                  >
                    {truncateUrl(p.url)}
                  </a>
                </TableCell>
                <TableCell>
                  {p.detectedType ? (
                    <Badge variant="secondary" className="text-xs">
                      {TYPE_LABELS[p.detectedType] ?? p.detectedType}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {p.kennelName ?? "—"}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant="outline" className="text-xs">
                    {p.regionAbbrev}
                  </Badge>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {p.confidence ? (
                    <span className={CONFIDENCE_COLORS[p.confidence] ?? ""}>
                      {p.confidence}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                  {formatMethod(p.discoveryMethod)}
                </TableCell>
                <TableCell className="text-right space-x-1">
                  {p.status === "PENDING" && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedProposal(p)}
                      >
                        Review
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleReject(p.id)}
                        disabled={isPending}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  {p.status === "ERROR" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedProposal(p)}
                    >
                      Review
                    </Button>
                  )}
                  {p.status === "APPROVED" && (
                    <span className="text-xs text-green-600">Approved</span>
                  )}
                  {p.status === "REJECTED" && (
                    <span className="text-xs text-muted-foreground">Rejected</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Approval dialog */}
      {selectedProposal && (
        <ProposalApprovalDialog
          proposal={selectedProposal}
          onClose={() => {
            setSelectedProposal(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30
      ? u.pathname.slice(0, 30) + "..."
      : u.pathname;
    return u.hostname + path;
  } catch {
    return url.slice(0, 50);
  }
}

function formatMethod(method: string): string {
  switch (method) {
    case "WEB_SEARCH": return "Search";
    case "KENNEL_WEBSITE": return "Kennel";
    case "DISCOVERY_WEBSITE": return "Discovery";
    default: return method;
  }
}
