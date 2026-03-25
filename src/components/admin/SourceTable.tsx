"use client";

import { useState, useMemo, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deleteSource, toggleSourceEnabled } from "@/app/admin/sources/actions";
import { formatRelativeTime } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SourceForm } from "./SourceForm";
import { KennelOptionLabel } from "@/components/kennels/KennelOptionLabel";
import { toast } from "sonner";
import type { RegionOption } from "./RegionCombobox";
import { getStateGroup, groupRegionsByState, expandRegionSelections } from "@/lib/region";

type SourceData = {
  id: string;
  name: string;
  url: string;
  type: string;
  trustLevel: number;
  scrapeFreq: string;
  scrapeDays: number;
  config: unknown;
  healthStatus: string;
  lastScrapeAt: string | null;
  lastSuccessAt: string | null;
  linkedKennels: { id: string; shortName: string; fullName: string }[];
  rawEventCount: number;
  openAlertTags: string[];
  enabled: boolean;
};

interface SourceTableProps {
  sources: SourceData[];
  allKennels: { id: string; shortName: string; fullName: string; region: string }[];
  allRegions: RegionOption[];
  geminiAvailable?: boolean;
}

const healthColors: Record<string, string> = {
  HEALTHY: "default",
  DEGRADED: "secondary",
  FAILING: "destructive",
  STALE: "outline",
  UNKNOWN: "outline",
};

export const TYPE_LABELS: Record<string, string> = {
  HTML_SCRAPER: "HTML Scraper",
  GOOGLE_CALENDAR: "Google Calendar",
  GOOGLE_SHEETS: "Google Sheets",
  ICAL_FEED: "iCal Feed",
  RSS_FEED: "RSS Feed",
  JSON_API: "JSON API",
  HASHREGO: "Hash Rego",
  STATIC_SCHEDULE: "Static Schedule",
  MANUAL: "Manual",
};

const HEALTH_OPTIONS = ["HEALTHY", "DEGRADED", "FAILING", "STALE", "UNKNOWN"];
type SortKey = "name" | "type" | "healthStatus" | "lastScrapeAt" | "linkedKennels" | "rawEventCount";
type SortDirection = "asc" | "desc";

function getNextSortDirection(currentKey: SortKey, activeKey: SortKey, currentDirection: SortDirection): SortDirection {
  if (currentKey !== activeKey) return "asc";
  return currentDirection === "asc" ? "desc" : "asc";
}

function getSortIndicator(isActive: boolean, direction: SortDirection): string {
  if (!isActive) return "↕";
  return direction === "asc" ? "↑" : "↓";
}

function SortableTableHead({
  label,
  sortKey,
  activeSortKey,
  direction,
  onSort,
  className,
}: Readonly<{
  label: string;
  sortKey: SortKey;
  activeSortKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  className?: string;
}>) {
  const isActive = activeSortKey === sortKey;
  const ariaLabel = isActive ? `Sort by ${label} (${direction})` : `Sort by ${label}`;
  return (
    <TableHead className={className}>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-left hover:text-foreground/90"
        onClick={() => onSort(sortKey)}
        aria-label={ariaLabel}
      >
        <span>{label}</span>
        <span aria-hidden="true">{getSortIndicator(isActive, direction)}</span>
      </button>
    </TableHead>
  );
}

/** Admin source table with kennel/type/health filtering and per-row actions. */
export function SourceTable({ sources, allKennels, allRegions, geminiAvailable }: SourceTableProps) {
  const [selectedKennels, setSelectedKennels] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedHealth, setSelectedHealth] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Build kennel→region lookup for region filtering
  const kennelRegionMap = useMemo(
    () => new Map(allKennels.map((k) => [k.id, k.region])),
    [allKennels],
  );

  // Only show regions that have sources linked
  const availableRegions = useMemo(
    () =>
      Array.from(
        new Set(
          sources.flatMap((s) =>
            s.linkedKennels.map((k) => kennelRegionMap.get(k.id)).filter((v): v is string => Boolean(v)),
          ),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [sources, kennelRegionMap],
  );

  // Group metro regions by state for hierarchical filter
  const regionsByState = useMemo(() => groupRegionsByState(availableRegions), [availableRegions]);
  const stateKeys = useMemo(
    () => Array.from(regionsByState.keys()).sort((a, b) => a.localeCompare(b)),
    [regionsByState],
  );

  // Only show types that exist in sources
  const availableTypes = useMemo(
    () => Array.from(new Set(sources.map((s) => s.type))).sort((a, b) => a.localeCompare(b)),
    [sources],
  );

  // Expand state-level selections to metro regions (hoisted out of filter loop)
  const expandedRegions = useMemo(
    () => (selectedRegions.length > 0 ? expandRegionSelections(selectedRegions, regionsByState) : null),
    [selectedRegions, regionsByState],
  );

  const filteredSources = useMemo(
    () =>
      sources.filter((source) => {
        if (selectedKennels.length > 0) {
          const hasMatch = source.linkedKennels.some((k) => selectedKennels.includes(k.id));
          if (!hasMatch) return false;
        }
        if (expandedRegions) {
          const hasMatch = source.linkedKennels.some((k) =>
            expandedRegions.has(kennelRegionMap.get(k.id) ?? ""),
          );
          if (!hasMatch) return false;
        }
        if (selectedTypes.length > 0 && !selectedTypes.includes(source.type)) {
          return false;
        }
        if (selectedHealth.length > 0 && !selectedHealth.includes(source.healthStatus)) {
          return false;
        }
        return true;
      }),
    [sources, selectedKennels, expandedRegions, selectedTypes, selectedHealth, kennelRegionMap],
  );

  const handleSort = useCallback(
    (key: SortKey) => {
      const nextDirection = getNextSortDirection(key, sortKey, sortDirection);
      setSortKey(key);
      setSortDirection(nextDirection);
    },
    [sortKey, sortDirection],
  );

  const sortedSources = useMemo(
    () =>
      [...filteredSources].sort((a, b) => {
        const order = sortDirection === "asc" ? 1 : -1;

        switch (sortKey) {
          case "name":
            return order * a.name.localeCompare(b.name);
          case "type":
            return order * (TYPE_LABELS[a.type] ?? a.type).localeCompare(TYPE_LABELS[b.type] ?? b.type);
          case "healthStatus":
            return order * a.healthStatus.localeCompare(b.healthStatus);
          case "lastScrapeAt": {
            // Nulls always sort last regardless of direction
            if (!a.lastScrapeAt && !b.lastScrapeAt) return 0;
            if (!a.lastScrapeAt) return 1;
            if (!b.lastScrapeAt) return -1;
            return order * (new Date(a.lastScrapeAt).getTime() - new Date(b.lastScrapeAt).getTime());
          }
          case "linkedKennels":
            return order * (a.linkedKennels.length - b.linkedKennels.length);
          case "rawEventCount":
            return order * (a.rawEventCount - b.rawEventCount);
          default:
            return 0;
        }
      }),
    [filteredSources, sortKey, sortDirection],
  );

  if (sources.length === 0) {
    return <p className="text-sm text-muted-foreground">No sources yet.</p>;
  }

  const activeFilterCount =
    selectedKennels.length + selectedRegions.length + selectedTypes.length + selectedHealth.length;

  function toggleKennel(id: string) {
    setSelectedKennels((prev) =>
      prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id],
    );
  }

  function toggleRegion(region: string) {
    const state = getStateGroup(region);
    const stateKey = `state:${state}`;
    setSelectedRegions((prev) => {
      if (prev.includes(stateKey)) {
        // State is selected — explode to individual metros minus this one
        const metros = regionsByState.get(state) ?? [];
        return [
          ...prev.filter((r) => r !== stateKey),
          ...metros.filter((m) => m !== region),
        ];
      }
      return prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region];
    });
  }

  function toggleStateGroup(state: string) {
    const stateKey = `state:${state}`;
    const metros = regionsByState.get(state) ?? [];
    setSelectedRegions((prev) => {
      const isSelected = prev.includes(stateKey) ||
        metros.every((m) => prev.includes(m));
      return isSelected
        ? prev.filter((r) => r !== stateKey && !metros.includes(r))
        : [...prev.filter((r) => !metros.includes(r)), stateKey];
    });
  }

  function toggleType(type: string) {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

  function toggleHealth(status: string) {
    setSelectedHealth((prev) =>
      prev.includes(status)
        ? prev.filter((h) => h !== status)
        : [...prev, status],
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Kennel filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Kennel
              {selectedKennels.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {selectedKennels.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search kennels..." />
              <CommandList>
                <CommandEmpty>No kennels found.</CommandEmpty>
                <CommandGroup>
                  {allKennels.map((kennel) => (
                    <CommandItem
                      key={kennel.id}
                      value={`${kennel.shortName} ${kennel.fullName} ${kennel.region}`}
                      onSelect={() => toggleKennel(kennel.id)}
                    >
                      <span
                        className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                          selectedKennels.includes(kennel.id)
                            ? "bg-primary border-primary text-primary-foreground"
                            : "opacity-50"
                        }`}
                      >
                        {selectedKennels.includes(kennel.id) && "✓"}
                      </span>
                      <KennelOptionLabel kennel={kennel} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Region filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Region
              {selectedRegions.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {selectedRegions.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 max-w-[calc(100vw-2rem)] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search regions..." />
              <CommandList>
                <CommandEmpty>No regions found.</CommandEmpty>
                {stateKeys.map((state) => {
                  const metros = regionsByState.get(state) ?? [];
                  const stateKey = `state:${state}`;
                  const isStateSelected = selectedRegions.includes(stateKey) ||
                    metros.every((m) => selectedRegions.includes(m));
                  return (
                    <CommandGroup key={state} heading={state}>
                      {metros.length > 1 && (
                        <CommandItem
                          value={`${state} all`}
                          onSelect={() => toggleStateGroup(state)}
                        >
                          <span
                            className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                              isStateSelected
                                ? "bg-primary border-primary text-primary-foreground"
                                : "opacity-50"
                            }`}
                          >
                            {isStateSelected && "✓"}
                          </span>
                          <span className="font-medium">All {state}</span>
                        </CommandItem>
                      )}
                      {metros.map((region) => {
                        const isRegionSelected = selectedRegions.includes(region) ||
                          selectedRegions.includes(stateKey);
                        return (
                          <CommandItem
                            key={region}
                            value={region}
                            onSelect={() => toggleRegion(region)}
                          >
                            <span
                              className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                                isRegionSelected
                                  ? "bg-primary border-primary text-primary-foreground"
                                  : "opacity-50"
                              }`}
                            >
                              {isRegionSelected && "✓"}
                            </span>
                            <span className={metros.length > 1 ? "pl-2" : ""}>{region}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  );
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Type filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Type
              {selectedTypes.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {selectedTypes.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-0" align="start">
            <Command>
              <CommandList>
                <CommandGroup>
                  {availableTypes.map((type) => (
                    <CommandItem
                      key={type}
                      onSelect={() => toggleType(type)}
                    >
                      <span
                        className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                          selectedTypes.includes(type)
                            ? "bg-primary border-primary text-primary-foreground"
                            : "opacity-50"
                        }`}
                      >
                        {selectedTypes.includes(type) && "✓"}
                      </span>
                      {TYPE_LABELS[type] ?? type}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Health filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Health
              {selectedHealth.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {selectedHealth.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-44 p-0" align="start">
            <Command>
              <CommandList>
                <CommandGroup>
                  {HEALTH_OPTIONS.map((status) => (
                    <CommandItem
                      key={status}
                      onSelect={() => toggleHealth(status)}
                    >
                      <span
                        className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                          selectedHealth.includes(status)
                            ? "bg-primary border-primary text-primary-foreground"
                            : "opacity-50"
                        }`}
                      >
                        {selectedHealth.includes(status) && "✓"}
                      </span>
                      {status}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Clear filters */}
        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setSelectedKennels([]);
              setSelectedRegions([]);
              setSelectedTypes([]);
              setSelectedHealth([]);
            }}
          >
            Clear filters
          </Button>
        )}

        {/* Filtered count */}
        {activeFilterCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {filteredSources.length} of {sources.length} sources
          </span>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <SortableTableHead
              label="Name"
              sortKey="name"
              activeSortKey={sortKey}
              direction={sortDirection}
              onSort={handleSort}
            />
            <SortableTableHead
              label="Type"
              sortKey="type"
              activeSortKey={sortKey}
              direction={sortDirection}
              onSort={handleSort}
              className="hidden sm:table-cell"
            />
            <SortableTableHead
              label="Health"
              sortKey="healthStatus"
              activeSortKey={sortKey}
              direction={sortDirection}
              onSort={handleSort}
            />
            <SortableTableHead
              label="Last Scrape"
              sortKey="lastScrapeAt"
              activeSortKey={sortKey}
              direction={sortDirection}
              onSort={handleSort}
              className="hidden sm:table-cell"
            />
            <SortableTableHead
              label="Linked"
              sortKey="linkedKennels"
              activeSortKey={sortKey}
              direction={sortDirection}
              onSort={handleSort}
              className="hidden sm:table-cell text-center"
            />
            <SortableTableHead
              label="Raw Events"
              sortKey="rawEventCount"
              activeSortKey={sortKey}
              direction={sortDirection}
              onSort={handleSort}
              className="hidden sm:table-cell text-center"
            />
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedSources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              allKennels={allKennels}
              allRegions={allRegions}
              geminiAvailable={geminiAvailable}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SourceRow({
  source,
  allKennels,
  allRegions,
  geminiAvailable,
}: {
  source: SourceData;
  allKennels: { id: string; shortName: string; fullName: string; region: string }[];
  allRegions: RegionOption[];
  geminiAvailable?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const router = useRouter();

  function handleToggleEnabled() {
    setMenuOpen(false);
    startTransition(async () => {
      const result = await toggleSourceEnabled(source.id, !source.enabled);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(source.enabled ? "Source disabled" : "Source enabled");
      }
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm(`Delete source "${source.name}"? This cannot be undone.`)) {
      return;
    }

    setMenuOpen(false);
    startTransition(async () => {
      const result = await deleteSource(source.id);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Source deleted");
      }
      router.refresh();
    });
  }

  async function handleScrape(force: boolean) {
    if (
      force &&
      !confirm(
        "Force re-scrape will delete all existing raw events and re-scrape from scratch. Continue?",
      )
    ) {
      return;
    }

    setMenuOpen(false);
    setIsScraping(true);
    try {
      const res = await fetch("/api/admin/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: source.id,
          days: 90,
          force,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Scrape failed");
      } else {
        toast.success(
          `${force ? "Force re-scrape" : "Scrape"} complete: ${data.eventsFound} found, ${data.created} created, ${data.updated} updated`,
        );
      }
      router.refresh();
    } catch {
      toast.error("Scrape request failed");
    } finally {
      setIsScraping(false);
    }
  }

  const fullDate = source.lastScrapeAt
    ? new Date(source.lastScrapeAt).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : null;

  return (
    <TableRow className={!source.enabled ? "opacity-50" : undefined}>
      <TableCell>
        <div className="max-w-[200px] sm:max-w-[280px]">
          <div className="flex items-center gap-1.5">
            <Link href={`/admin/sources/${source.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
              {source.name}
            </Link>
            {!source.enabled && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground border-muted-foreground/30">
                disabled
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground" title={source.url}>
            {source.url}
          </p>
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Badge variant="outline" className="text-xs">
          {TYPE_LABELS[source.type] ?? source.type}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Badge
            variant={
              healthColors[source.healthStatus] as
                | "default"
                | "secondary"
                | "destructive"
                | "outline"
            }
          >
            {source.healthStatus}
          </Badge>
          {source.healthStatus === "HEALTHY" && source.rawEventCount === 0 && source.lastScrapeAt && (
            <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">
              0 events
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
        {source.lastScrapeAt ? (
          <span title={fullDate ?? undefined}>
            {formatRelativeTime(source.lastScrapeAt)}
          </span>
        ) : (
          "Never"
        )}
      </TableCell>
      <TableCell className="hidden sm:table-cell text-center">
        {source.linkedKennels.length > 0 ? (
          <Tooltip>
            <TooltipTrigger className="cursor-help">
              {source.linkedKennels.length}
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              {source.linkedKennels.map((k) => k.shortName).join(", ")}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </TableCell>
      <TableCell className="hidden sm:table-cell text-center">{source.rawEventCount}</TableCell>
      <TableCell>
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
              <span className="sr-only">Actions</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-40 p-1">
            <SourceForm
              source={{
                id: source.id,
                name: source.name,
                url: source.url,
                type: source.type,
                trustLevel: source.trustLevel,
                scrapeFreq: source.scrapeFreq,
                scrapeDays: source.scrapeDays,
                config: source.config,
                linkedKennelIds: source.linkedKennels.map((k) => k.id),
              }}
              openAlertTags={source.openAlertTags}
              geminiAvailable={geminiAvailable}
              allKennels={allKennels}
              allRegions={allRegions}
              trigger={
                <button
                  className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  onClick={() => setMenuOpen(false)}
                >
                  Edit
                </button>
              }
            />
            <div className="my-1 border-t" />
            <button
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              onClick={() => handleScrape(false)}
              disabled={isScraping}
            >
              {isScraping ? "Scraping..." : "Scrape"}
            </button>
            <button
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-amber-700 hover:bg-accent disabled:opacity-50"
              onClick={() => handleScrape(true)}
              disabled={isScraping}
            >
              Force Scrape
            </button>
            <button
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
              onClick={handleToggleEnabled}
              disabled={isPending}
            >
              {source.enabled ? "Disable" : "Enable"}
            </button>
            <div className="my-1 border-t" />
            <button
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-accent"
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending ? "Deleting..." : "Delete"}
            </button>
          </PopoverContent>
        </Popover>
      </TableCell>
    </TableRow>
  );
}
