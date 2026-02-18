"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deleteSource } from "@/app/admin/sources/actions";
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
import { toast } from "sonner";

type SourceData = {
  id: string;
  name: string;
  url: string;
  type: string;
  trustLevel: number;
  scrapeFreq: string;
  healthStatus: string;
  lastScrapeAt: string | null;
  lastSuccessAt: string | null;
  linkedKennels: { id: string; shortName: string; fullName: string }[];
  rawEventCount: number;
};

interface SourceTableProps {
  sources: SourceData[];
  allKennels: { id: string; shortName: string }[];
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
  MANUAL: "Manual",
};

const HEALTH_OPTIONS = ["HEALTHY", "DEGRADED", "FAILING", "STALE", "UNKNOWN"];

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function SourceTable({ sources, allKennels }: SourceTableProps) {
  const [selectedKennels, setSelectedKennels] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedHealth, setSelectedHealth] = useState<string[]>([]);

  if (sources.length === 0) {
    return <p className="text-sm text-muted-foreground">No sources yet.</p>;
  }

  const filteredSources = sources.filter((source) => {
    if (selectedKennels.length > 0) {
      const hasMatch = source.linkedKennels.some((k) =>
        selectedKennels.includes(k.id),
      );
      if (!hasMatch) return false;
    }
    if (selectedTypes.length > 0 && !selectedTypes.includes(source.type)) {
      return false;
    }
    if (
      selectedHealth.length > 0 &&
      !selectedHealth.includes(source.healthStatus)
    ) {
      return false;
    }
    return true;
  });

  const activeFilterCount =
    selectedKennels.length + selectedTypes.length + selectedHealth.length;

  function toggleKennel(id: string) {
    setSelectedKennels((prev) =>
      prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id],
    );
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

  // Only show types that exist in sources
  const availableTypes = Array.from(new Set(sources.map((s) => s.type))).sort();

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
          <PopoverContent className="w-56 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search kennels..." />
              <CommandList>
                <CommandEmpty>No kennels found.</CommandEmpty>
                <CommandGroup>
                  {allKennels.map((kennel) => (
                    <CommandItem
                      key={kennel.id}
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
                      {kennel.shortName}
                    </CommandItem>
                  ))}
                </CommandGroup>
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
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Health</TableHead>
            <TableHead>Last Scrape</TableHead>
            <TableHead className="text-center">Linked</TableHead>
            <TableHead className="text-center">Raw Events</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredSources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              allKennels={allKennels}
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
}: {
  source: SourceData;
  allKennels: { id: string; shortName: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const router = useRouter();

  function handleDelete() {
    if (!confirm(`Delete source "${source.name}"? This cannot be undone.`)) {
      return;
    }

    setMenuOpen(false);
    startTransition(async () => {
      const result = await deleteSource(source.id);
      if (result.error) {
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
    <TableRow>
      <TableCell>
        <div className="max-w-[280px]">
          <Link href={`/admin/sources/${source.id}`} className="font-medium hover:underline">
            {source.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground" title={source.url}>
            {source.url}
          </p>
        </div>
      </TableCell>
      <TableCell>
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
      <TableCell className="text-xs text-muted-foreground">
        {source.lastScrapeAt ? (
          <span title={fullDate ?? undefined}>
            {relativeTime(source.lastScrapeAt)}
          </span>
        ) : (
          "Never"
        )}
      </TableCell>
      <TableCell className="text-center">
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
      <TableCell className="text-center">{source.rawEventCount}</TableCell>
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
                linkedKennelIds: source.linkedKennels.map((k) => k.id),
              }}
              allKennels={allKennels}
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
