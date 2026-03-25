"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  startRegionResearch,
  rejectProposal,
  bulkRejectProposals,
  resolveKennelSuggestion,
} from "@/app/admin/research/actions";
import { ProposalApprovalDialog } from "./ProposalApprovalDialog";
import { KennelDiscoveryCard } from "./KennelDiscoveryCard";
import { AddKennelFromResearchDialog } from "./AddKennelFromResearchDialog";
import { TYPE_LABELS } from "./SourceTable";
import type { SourceType, ProposalStatus, DiscoveryStatus, RequestStatus, SuggestionRelationship } from "@/generated/prisma/client";
import type { ConfidenceLevel } from "@/pipeline/source-research";

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
  confidence: ConfidenceLevel | null;
  explanation: string | null;
  status: ProposalStatus;
  createdSourceId: string | null;
  createdAt: string;
}

export interface SerializedDiscovery {
  id: string;
  externalSlug: string;
  name: string;
  location: string | null;
  website: string | null;
  schedule: string | null;
  yearStarted: number | null;
  status: DiscoveryStatus;
  matchedKennelId: string | null;
  matchedKennelName: string | null;
  matchScore: number | null;
  matchCandidates: { id: string; shortName: string; score: number }[];
  regionId: string | null;
  regionName: string | null;
}

export interface SerializedSuggestion {
  id: string;
  kennelName: string;
  region: string | null;
  regionName: string | null;
  regionAbbrev: string | null;
  regionId: string | null;
  sourceUrl: string | null;
  notes: string | null;
  relationship: SuggestionRelationship | null;
  email: string | null;
  status: RequestStatus;
  createdAt: string;
  resolvedAt: string | null;
}

interface Props {
  regions: { id: string; name: string; abbrev: string; country: string }[];
  proposals: SerializedProposal[];
  discoveries: SerializedDiscovery[];
  coverageGaps: Record<string, { id: string; shortName: string; website: string | null }[]>;
  statusCounts: { pending: number; approved: number; rejected: number; error: number; total: number };
  kennels: { id: string; shortName: string; fullName: string | null }[];
  suggestions: SerializedSuggestion[];
}

type StatusFilter = "PENDING" | "APPROVED" | "REJECTED" | "ERROR" | "ALL" | "SUGGESTIONS";

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "text-green-600",
  medium: "text-yellow-600",
  low: "text-red-600",
};

/** Only allow http/https URLs in href to prevent javascript: XSS. */
function isSafeUrl(url: string): boolean {
  try { return /^https?:$/i.test(new URL(url).protocol); }
  catch { return false; }
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  HASH_WITH: "Hashes with them",
  ON_MISMAN: "On mismanagement",
  FOUND_ONLINE: "Found online",
};

export function ResearchDashboard({ regions, proposals, discoveries, coverageGaps, statusCounts, kennels, suggestions }: Readonly<Props>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [regionInput, setRegionInput] = useState("");
  const [selectedRegionId, setSelectedRegionId] = useState<string>("");
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("PENDING");
  const [selectedProposal, setSelectedProposal] = useState<SerializedProposal | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addDiscovery, setAddDiscovery] = useState<SerializedDiscovery | null>(null);

  const pendingSuggestionCount = suggestions.filter((s) => s.status === "PENDING").length;

  // Display text for the combobox trigger
  const selectedRegion = regions.find((r) => r.id === selectedRegionId);
  const displayText = selectedRegion
    ? `${selectedRegion.name} (${selectedRegion.abbrev})`
    : regionInput || "Type or select a region...";

  function selectRegion(regionId: string) {
    const region = regions.find((r) => r.id === regionId);
    setSelectedRegionId(regionId);
    setRegionInput(region?.name ?? "");
    setComboboxOpen(false);
    setSelectedIds(new Set());
  }

  function handleInputChange(value: string) {
    setRegionInput(value);
    // If input matches an existing region name exactly, select it
    const match = regions.find((r) => r.name.toLowerCase() === value.toLowerCase());
    if (match) {
      setSelectedRegionId(match.id);
    } else {
      setSelectedRegionId("");
    }
  }

  function changeStatusFilter(v: string) {
    setStatusFilter(v as StatusFilter);
    setSelectedIds(new Set());
  }

  const gaps = selectedRegionId ? (coverageGaps[selectedRegionId] ?? []) : [];

  // Filter discoveries by selected region
  const filteredDiscoveries = useMemo(() => {
    if (!selectedRegionId) return discoveries;
    return discoveries.filter((d) => d.regionId === selectedRegionId);
  }, [discoveries, selectedRegionId]);

  const filteredProposals = proposals.filter((p) => {
    if (selectedRegionId && p.regionId !== selectedRegionId) return false;
    if (statusFilter !== "ALL" && p.status !== statusFilter) return false;
    return true;
  });

  // Kennels in selected region (for linking)
  const regionKennels = useMemo(() => {
    if (!selectedRegionId) return [];
    const gapKennels = coverageGaps[selectedRegionId] ?? [];
    return gapKennels.map((k) => ({ id: k.id, shortName: k.shortName }));
  }, [selectedRegionId, coverageGaps]);

  function handleResearch() {
    // Use regionId if matched, otherwise use the free-text input
    const researchTarget = selectedRegionId || regionInput.trim();
    if (!researchTarget) {
      toast.error("Enter a region name or select one");
      return;
    }
    startTransition(async () => {
      const result = await startRegionResearch(researchTarget);
      if ("error" in result && result.error) {
        toast.error(result.error);
      } else if ("success" in result) {
        const parts: string[] = [];
        if (result.kennelsDiscovered) parts.push(`${result.kennelsDiscovered} kennels discovered`);
        if (result.kennelsMatched) parts.push(`${result.kennelsMatched} matched`);
        if (result.urlsDiscovered) parts.push(`${result.urlsDiscovered} URLs found`);
        if (result.proposalsCreated) parts.push(`${result.proposalsCreated} proposals`);
        if (result.errors?.length) {
          const [first, ...rest] = result.errors;
          const msg = rest.length ? `${first} (+${rest.length} more)` : first;
          toast.warning(`Research warning: ${msg}`);
        }
        toast.success(`Research complete: ${parts.join(", ") || "no new results"}`);
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

  function handleResolveSuggestion(id: string, resolution: "APPROVED" | "REJECTED") {
    startTransition(async () => {
      const result = await resolveKennelSuggestion(id, resolution);
      if (!result.success) {
        toast.error(result.error ?? "Failed to resolve suggestion");
      } else {
        toast.success(`Suggestion ${resolution.toLowerCase()}`);
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

  // Group regions by country for the command list
  const grouped = regions.reduce<Record<string, typeof regions>>((acc, r) => {
    if (!acc[r.country]) acc[r.country] = [];
    acc[r.country].push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Region input + research button */}
      <div className="flex items-center gap-3 flex-wrap">
        <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={comboboxOpen}
              className="w-72 justify-between font-normal"
            >
              <span className="truncate">{displayText}</span>
              <svg aria-hidden="true" className="ml-2 h-4 w-4 shrink-0 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="start">
            <Command>
              <CommandInput
                placeholder="Search or type new region..."
                value={regionInput}
                onValueChange={handleInputChange}
              />
              <CommandList>
                <CommandEmpty>
                  {regionInput.trim() ? (
                    <button
                      className="w-full px-2 py-3 text-sm text-left hover:bg-accent cursor-pointer"
                      onClick={() => {
                        setSelectedRegionId("");
                        setComboboxOpen(false);
                      }}
                    >
                      Research &ldquo;{regionInput.trim()}&rdquo; (new region)
                    </button>
                  ) : (
                    "No region found."
                  )}
                </CommandEmpty>
                {Object.entries(grouped).map(([country, countryRegions]) => (
                  <CommandGroup key={country} heading={country}>
                    {countryRegions.map((r) => (
                      <CommandItem
                        key={r.id}
                        value={`${r.name} ${r.abbrev}`}
                        onSelect={() => selectRegion(r.id)}
                      >
                        {r.name}
                        <span className="ml-auto text-xs text-muted-foreground">{r.abbrev}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Button
          onClick={handleResearch}
          disabled={(!selectedRegionId && !regionInput.trim()) || isPending}
        >
          {isPending ? "Researching..." : "Research Region"}
        </Button>

        {!selectedRegionId && regionInput.trim() && (
          <span className="text-xs text-muted-foreground">
            New region will be created
          </span>
        )}
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

      {/* Discovered Kennels section */}
      {filteredDiscoveries.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Discovered Kennels ({filteredDiscoveries.length})
            </h3>
            <span className="text-xs text-muted-foreground">
              AI-discovered via Gemini search
            </span>
          </div>
          <div className="space-y-2">
            {filteredDiscoveries.map((d) => (
              <KennelDiscoveryCard
                key={d.id}
                discovery={d}
                kennels={regionKennels}
                onAdd={setAddDiscovery}
              />
            ))}
          </div>
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Tabs
          value={statusFilter}
          onValueChange={changeStatusFilter}
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
            <TabsTrigger value="SUGGESTIONS" className="relative">
              Suggestions{pendingSuggestionCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-orange-500 text-white text-[10px] font-bold w-5 h-5">
                  {pendingSuggestionCount}
                </span>
              )}
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

      {/* Suggestions table (when Suggestions tab active) */}
      {statusFilter === "SUGGESTIONS" ? (
        suggestions.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kennel Name</TableHead>
                <TableHead className="hidden sm:table-cell">Region</TableHead>
                <TableHead className="hidden md:table-cell">Relationship</TableHead>
                <TableHead className="hidden lg:table-cell">Website</TableHead>
                <TableHead className="hidden sm:table-cell">Submitted By</TableHead>
                <TableHead className="hidden md:table-cell">Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suggestions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    {s.kennelName}
                    {s.notes && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="ml-1 text-muted-foreground cursor-help text-xs">[notes]</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          {s.notes}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {s.regionAbbrev ? (
                      <Badge variant="outline" className="text-xs">
                        {s.regionAbbrev}
                      </Badge>
                    ) : s.regionName ? (
                      <span className="text-xs text-muted-foreground">{s.regionName}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {s.relationship ? (
                      <Badge
                        variant="secondary"
                        className={`text-xs ${s.relationship === "ON_MISMAN" ? "bg-amber-100 text-amber-800 border-amber-300" : ""}`}
                      >
                        {RELATIONSHIP_LABELS[s.relationship] ?? s.relationship}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell max-w-[200px] truncate">
                    {s.sourceUrl && isSafeUrl(s.sourceUrl) ? (
                      <a
                        href={s.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline-offset-4 hover:underline"
                        title={s.sourceUrl}
                      >
                        {truncateUrl(s.sourceUrl)}
                      </a>
                    ) : s.sourceUrl ? (
                      <span className="text-muted-foreground" title={s.sourceUrl}>
                        {truncateUrl(s.sourceUrl)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-xs">
                    {s.email ?? "Anonymous"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                    {new Date(s.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {s.status === "PENDING" && (
                      <Badge variant="outline" className="text-xs text-yellow-700 border-yellow-400">
                        Pending
                      </Badge>
                    )}
                    {s.status === "APPROVED" && (
                      <Badge variant="outline" className="text-xs text-green-700 border-green-400">
                        Approved
                      </Badge>
                    )}
                    {s.status === "REJECTED" && (
                      <Badge variant="outline" className="text-xs text-red-700 border-red-400">
                        Rejected
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    {s.status === "PENDING" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResolveSuggestion(s.id, "APPROVED")}
                          disabled={isPending}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleResolveSuggestion(s.id, "REJECTED")}
                          disabled={isPending}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No public kennel suggestions yet.
          </p>
        )
      ) : (
        /* Proposals table (all other tabs) */
        filteredProposals.length > 0 ? (
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
                    {isSafeUrl(p.url) ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline-offset-4 hover:underline"
                        title={p.url}
                      >
                        {truncateUrl(p.url)}
                      </a>
                    ) : (
                      <span className="text-muted-foreground" title={p.url}>
                        {truncateUrl(p.url)}
                      </span>
                    )}
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
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {statusFilter === "PENDING"
              ? "No pending proposals. Select a region and click Research to discover sources."
              : "No proposals match this filter."}
          </p>
        )
      )}

      {/* Approval dialog */}
      {selectedProposal && (
        <ProposalApprovalDialog
          proposal={selectedProposal}
          kennels={kennels}
          onClose={() => {
            setSelectedProposal(null);
            router.refresh();
          }}
        />
      )}

      {/* Add kennel dialog */}
      {addDiscovery && (
        <AddKennelFromResearchDialog
          discovery={addDiscovery}
          regionId={selectedRegionId}
          onClose={() => setAddDiscovery(null)}
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
    case "DISCOVERY_SEARCH": return "AI Search";
    case "EMBEDDED_DISCOVERY": return "Embedded";
    default: return method;
  }
}
