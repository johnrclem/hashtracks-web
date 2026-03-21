"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useMemo, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { KennelOptionLabel } from "@/components/kennels/KennelOptionLabel";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { AttendanceBadge } from "./AttendanceBadge";
import { EditAttendanceDialog } from "./EditAttendanceDialog";
import type { AttendanceData } from "./CheckInButton";
import { participationLevelAbbrev, participationLevelLabel, PARTICIPATION_LEVELS, toggleArrayItem } from "@/lib/format";
import { getTodayUtcNoon } from "@/lib/date";
import { confirmAttendance, deleteAttendance } from "@/app/logbook/actions";
import { RegionBadge } from "@/components/hareline/RegionBadge";
import { getRegionColor } from "@/lib/region";

export interface LogbookEntry {
  attendance: AttendanceData;
  event: {
    id: string;
    date: string;
    runNumber: number | null;
    title: string | null;
    startTime: string | null;
    status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
    kennel: {
      id: string;
      shortName: string;
      fullName: string;
      slug: string;
      region: string;
    };
  };
}

type LogbookListProps = Readonly<{
  entries: LogbookEntry[];
  stravaConnected?: boolean;
  allRegions?: Array<{ id: string; name: string }>;
}>;


/** Format ISO date string to locale-friendly display (exported for testing). */
export function formatLogbookDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Filter logbook entries by region, kennel, and participation level (exported for testing). */
export function filterLogbookEntries(
  entries: LogbookEntry[],
  selectedRegions: string[],
  selectedKennels: string[],
  selectedLevels: string[],
): LogbookEntry[] {
  return entries.filter((e) => {
    if (selectedRegions.length > 0 && !selectedRegions.includes(e.event.kennel.region)) return false;
    if (selectedKennels.length > 0 && !selectedKennels.includes(e.event.kennel.id)) return false;
    if (selectedLevels.length > 0 && !selectedLevels.includes(e.attendance.participationLevel)) return false;
    return true;
  });
}

/** Check whether a logbook entry represents a future RSVP. */
function isUpcomingEntry(entry: LogbookEntry, todayUtcNoon: number): boolean {
  return entry.attendance.status === "INTENDING"
    && new Date(entry.event.date).getTime() > todayUtcNoon;
}

/** Derive a status label for accessibility (screen reader row summary). */
function getStatusLabel(entry: LogbookEntry, todayUtcNoon: number): string {
  if (entry.event.status === "CANCELLED") return "Cancelled";
  if (isUpcomingEntry(entry, todayUtcNoon)) return "Going";
  if (entry.attendance.status === "INTENDING") return "Pending confirmation";
  return participationLevelLabel(entry.attendance.participationLevel);
}

/** Column header row shared between sections. */
function ColumnHeaders() {
  return (
    <div
      className="flex items-center gap-2 sm:gap-3 px-4 pl-7 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b bg-muted/50 sticky top-14 z-10 rounded-t-lg"
      role="presentation"
    >
      <span className="shrink-0 sm:w-36">Date</span>
      <span className="shrink-0 sm:w-20">Kennel</span>
      <span className="hidden sm:inline-flex w-10">Region</span>
      <span className="hidden sm:inline-block w-12">Run #</span>
      <span className="hidden sm:block flex-1">Trail Name</span>
      <span className="ml-auto">Status</span>
    </div>
  );
}

export function LogbookList({ entries, stravaConnected, allRegions }: LogbookListProps) {
  const [editingEntry, setEditingEntry] = useState<LogbookEntry | null>(null);
  const [selectedKennels, setSelectedKennels] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const todayUtcNoon = getTodayUtcNoon();

  function handleRemove(attendanceId: string) {
    startTransition(async () => {
      const result = await deleteAttendance(attendanceId);
      if (!result.success) {
        toast.error(result.error);
      } else {
        toast("Removed from logbook");
      }
      router.refresh();
    });
  }

  function clearFilters() {
    setSelectedRegions([]);
    setSelectedKennels([]);
    setSelectedLevels([]);
  }

  // Derive unique kennels and regions
  const kennels = useMemo(() => {
    const map = new Map<string, { id: string; shortName: string; fullName: string; region: string }>();
    for (const e of entries) {
      if (!map.has(e.event.kennel.id)) {
        map.set(e.event.kennel.id, e.event.kennel);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.shortName.localeCompare(b.shortName));
  }, [entries]);

  // Compute per-region entry counts (for badge display)
  const regionEntryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      const r = e.event.kennel.region;
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  // Use server-provided allRegions (all METRO regions) when available,
  // otherwise fall back to deriving from entries for backwards compatibility
  const regions = useMemo(() => {
    if (allRegions && allRegions.length > 0) {
      return allRegions.map((r) => r.name);
    }
    const set = new Set(entries.map((e) => e.event.kennel.region));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allRegions, entries]);

  // Filter entries (uses module-level filterLogbookEntries, exported for testing)
  const filtered = useMemo(
    () => filterLogbookEntries(entries, selectedRegions, selectedKennels, selectedLevels),
    [entries, selectedRegions, selectedKennels, selectedLevels],
  );

  const activeFilterCount = selectedRegions.length + selectedKennels.length + selectedLevels.length;

  // Split into upcoming and past sections in a single pass (UX-01)
  const { upcoming, past } = useMemo(() => {
    const up: LogbookEntry[] = [];
    const pa: LogbookEntry[] = [];
    for (const e of filtered) {
      if (isUpcomingEntry(e, todayUtcNoon)) {
        up.push(e);
      } else {
        pa.push(e);
      }
    }
    // Sort upcoming entries nearest-first (ascending) — the main query sorts desc
    // which is correct for past entries, but upcoming should show soonest at top
    up.sort((a, b) => new Date(a.event.date).getTime() - new Date(b.event.date).getTime());
    return { upcoming: up, past: pa };
  }, [filtered, todayUtcNoon]);

  // Screen reader announcement for filter changes (a11y-04)
  // Use a ref-based approach: clear the live region briefly then set new text,
  // ensuring re-announcement even when the resulting text is identical.
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Clear then set to force screen reader re-announcement
    setLiveAnnouncement("");
    const id = requestAnimationFrame(() => {
      const total = filtered.length;
      const base = `Showing ${total} ${total === 1 ? "run" : "runs"}`;
      setLiveAnnouncement(activeFilterCount > 0 ? `${base}, filtered` : base);
    });
    return () => cancelAnimationFrame(id);
  }, [filtered.length, activeFilterCount, selectedRegions, selectedKennels, selectedLevels]);

  if (entries.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-lg font-medium">No check-ins yet</p>
        <p className="mt-1 text-muted-foreground">
          Head to the{" "}
          <Link href="/hareline?time=past" className="text-primary hover:underline">
            hareline
          </Link>{" "}
          and click &quot;I Was There&quot; on events you attended.
        </p>
      </div>
    );
  }

  function renderRow(entry: LogbookEntry) {
    const isUpcoming = isUpcomingEntry(entry, todayUtcNoon);
    const statusLabel = getStatusLabel(entry, todayUtcNoon);
    const rowLabel = `${formatLogbookDate(entry.event.date)} at ${entry.event.kennel.shortName}, ${entry.event.title || "no trail name"}, ${statusLabel}`;
    const regionColor = getRegionColor(entry.event.kennel.region);

    return (
      <li
        key={entry.attendance.id}
        className="rounded-xl border border-border/50 bg-card px-4 py-3 text-sm min-h-12"
        style={{
          borderLeftWidth: 3,
          borderLeftColor: isUpcoming ? "var(--primary)" : regionColor,
        }}
        aria-label={rowLabel}
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href={`/hareline/${entry.event.id}?from=logbook`}
            className="shrink-0 font-medium hover:underline sm:w-36"
          >
            {formatLogbookDate(entry.event.date)}
          </Link>
          <span className="shrink-0 sm:w-20">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={`/kennels/${entry.event.kennel.slug}`}
                  className="text-primary hover:underline"
                >
                  {entry.event.kennel.shortName}
                </Link>
              </TooltipTrigger>
              <TooltipContent>{entry.event.kennel.fullName}</TooltipContent>
            </Tooltip>
          </span>
          <span className="hidden sm:inline-flex">
            <RegionBadge region={entry.event.kennel.region} size="sm" />
          </span>
          {entry.event.runNumber && (
            <span className="hidden sm:inline-block w-12 shrink-0 text-muted-foreground">
              #{entry.event.runNumber}
            </span>
          )}
          {entry.event.title ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={`/hareline/${entry.event.id}?from=logbook`}
                  className="hidden sm:block min-w-0 flex-1 truncate text-muted-foreground hover:underline"
                >
                  {entry.event.title}
                </Link>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs break-words">
                {entry.event.title}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Link
              href={`/hareline/${entry.event.id}?from=logbook`}
              className="hidden sm:block min-w-0 flex-1 truncate italic text-muted-foreground/60 hover:text-muted-foreground hover:underline"
            >
              {entry.event.runNumber ? `Run #${entry.event.runNumber}` : "—"}
            </Link>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {entry.attendance.stravaUrl && (
              <a
                href={entry.attendance.stravaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-strava px-2 py-0.5 text-xs font-medium text-strava hover:bg-strava hover:text-white transition-colors"
              >
                <ExternalLink size={10} />
                {entry.attendance.stravaUrl.includes("strava.com")
                  ? "Strava"
                  : "Activity"}
              </a>
            )}
            {entry.event.status === "CANCELLED" ? (
              <span className="flex items-center gap-2">
                <Badge variant="destructive" className="h-7 text-xs">
                  Cancelled
                </Badge>
                {entry.attendance.status === "INTENDING" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-muted-foreground"
                    disabled={isPending}
                    onClick={() => handleRemove(entry.attendance.id)}
                  >
                    Remove
                  </Button>
                )}
              </span>
            ) : isUpcoming ? (
              <Badge
                variant="outline"
                className="h-7 cursor-pointer border-blue-300 text-blue-700 focus-visible:ring-2 focus-visible:ring-ring"
                role="button"
                tabIndex={0}
                onClick={() => setEditingEntry(entry)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setEditingEntry(entry);
                  }
                }}
              >
                Going
              </Badge>
            ) : entry.attendance.status === "INTENDING" ? (
              <span className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-amber-300 text-amber-700 hover:bg-amber-50"
                  disabled={isPending}
                  onClick={() => {
                    const attendanceId = entry.attendance.id;
                    startTransition(async () => {
                      const result = await confirmAttendance(attendanceId);
                      if (!result.success) {
                        toast.error(result.error);
                      } else {
                        toast.success("Attendance confirmed!");
                      }
                      router.refresh();
                    });
                  }}
                >
                  {isPending ? "..." : (
                    <>
                      <span className="hidden sm:inline">Confirm Attendance</span>
                      <span className="sm:hidden">Confirm</span>
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  disabled={isPending}
                  title="Remove from logbook"
                  aria-label="Remove from logbook"
                  onClick={() => handleRemove(entry.attendance.id)}
                >
                  &times;
                </Button>
              </span>
            ) : (
              <AttendanceBadge
                level={entry.attendance.participationLevel}
                size="sm"
                onClick={() => setEditingEntry(entry)}
              />
            )}
          </span>
        </div>
        {/* Mobile-only secondary row (a11y-05: hidden from screen readers) */}
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground sm:hidden" aria-hidden="true">
          <RegionBadge region={entry.event.kennel.region} size="sm" />
          {entry.event.runNumber && <span>#{entry.event.runNumber}</span>}
          {entry.event.title && (
            <Link
              href={`/hareline/${entry.event.id}`}
              className="min-w-0 flex-1 truncate hover:underline"
              tabIndex={-1}
            >
              {entry.event.title}
            </Link>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Region filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs" aria-label="Filter by Region">
              Region
              {selectedRegions.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {selectedRegions.length}
                </Badge>
              )}
              <ChevronDown size={14} className="ml-1 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search regions..." />
              <CommandList>
                <CommandEmpty>No regions found.</CommandEmpty>
                <CommandGroup>
                  {regions.map((region) => (
                    <CommandItem
                      key={region}
                      onSelect={() => setSelectedRegions(prev => toggleArrayItem(prev, region))}
                    >
                      <span
                        className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                          selectedRegions.includes(region)
                            ? "bg-primary border-primary text-primary-foreground"
                            : "opacity-50"
                        }`}
                      >
                        {selectedRegions.includes(region) && "✓"}
                      </span>
                      <span className="flex-1">{region}</span>
                      {(regionEntryCounts.get(region) ?? 0) > 0 && (
                        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                          {regionEntryCounts.get(region)}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Kennel filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs" aria-label="Filter by Kennel">
              Kennel
              {selectedKennels.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {selectedKennels.length}
                </Badge>
              )}
              <ChevronDown size={14} className="ml-1 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search kennels..." />
              <CommandList>
                <CommandEmpty>No kennels found.</CommandEmpty>
                <CommandGroup>
                  {kennels.map((kennel) => (
                    <CommandItem
                      key={kennel.id}
                      value={`${kennel.shortName} ${kennel.fullName} ${kennel.region}`}
                      onSelect={() => setSelectedKennels(prev => toggleArrayItem(prev, kennel.id))}
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

        {/* Level filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs" aria-label="Filter by Level">
              Level
              {selectedLevels.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {selectedLevels.length}
                </Badge>
              )}
              <ChevronDown size={14} className="ml-1 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-0" align="start">
            <Command>
              <CommandList>
                <CommandGroup>
                  {PARTICIPATION_LEVELS.map((level) => (
                    <CommandItem
                      key={level}
                      onSelect={() => setSelectedLevels(prev => toggleArrayItem(prev, level))}
                    >
                      <span
                        className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                          selectedLevels.includes(level)
                            ? "bg-primary border-primary text-primary-foreground"
                            : "opacity-50"
                        }`}
                      >
                        {selectedLevels.includes(level) && "✓"}
                      </span>
                      {participationLevelLabel(level)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={clearFilters}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Role legend (UI-04) */}
      <div className="flex flex-wrap gap-1.5">
        {PARTICIPATION_LEVELS.map((level) => (
          <span
            key={level}
            className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-xs text-muted-foreground"
          >
            <span className="font-semibold">{participationLevelAbbrev(level)}</span>
            {participationLevelLabel(level)}
          </span>
        ))}
      </div>

      {/* Live region for filter announcements (a11y-04) */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </div>

      {/* Empty filtered state (UX-05) */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <p className="text-sm">No runs match your filters.</p>
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          {/* Upcoming section (UX-01) */}
          {upcoming.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3 px-1">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Upcoming
                </h2>
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {upcoming.length}
                </span>
              </div>
              <ColumnHeaders />
              <ul role="list" aria-label="Upcoming runs" className="space-y-2 mt-2">
                {upcoming.map((entry) => renderRow(entry))}
              </ul>
            </div>
          )}

          {/* Divider between sections */}
          {upcoming.length > 0 && past.length > 0 && (
            <div className="my-6 border-t border-border/40" />
          )}

          {/* Past runs section (UX-01) */}
          {past.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3 px-1">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Past Runs
                </h2>
                <span className="inline-flex items-center rounded-full bg-foreground/[0.06] px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {past.length}
                </span>
              </div>
              <ColumnHeaders />
              <ul role="list" aria-label="Past runs" className="space-y-2 mt-2">
                {past.map((entry) => renderRow(entry))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Edit dialog */}
      {editingEntry && (
        <EditAttendanceDialog
          open={!!editingEntry}
          onOpenChange={(open) => {
            if (!open) setEditingEntry(null);
          }}
          attendance={editingEntry.attendance}
          eventDate={editingEntry.event.date}
          stravaConnected={stravaConnected}
        />
      )}
    </div>
  );
}
