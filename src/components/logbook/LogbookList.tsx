"use client";

import { useState, useMemo, useTransition } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
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
import { formatTime, participationLevelLabel, PARTICIPATION_LEVELS } from "@/lib/format";
import { confirmAttendance, deleteAttendance } from "@/app/logbook/actions";
import { RegionBadge } from "@/components/hareline/RegionBadge";

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

interface LogbookListProps {
  entries: LogbookEntry[];
}

function toggleFilter<T extends string>(setter: Dispatch<SetStateAction<T[]>>, value: T) {
  setter((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
}

export function LogbookList({ entries }: LogbookListProps) {
  const [editingAttendance, setEditingAttendance] = useState<AttendanceData | null>(null);
  const [selectedKennels, setSelectedKennels] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Determine "today" boundary for past/future event checks (UTC noon)
  const now = new Date();
  const todayUtcNoon = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12, 0, 0,
  );

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

  const regions = useMemo(() => {
    const set = new Set(entries.map((e) => e.event.kennel.region));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  // Filter entries
  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (selectedRegions.length > 0 && !selectedRegions.includes(e.event.kennel.region)) return false;
      if (selectedKennels.length > 0 && !selectedKennels.includes(e.event.kennel.id)) return false;
      if (selectedLevels.length > 0 && !selectedLevels.includes(e.attendance.participationLevel)) return false;
      return true;
    });
  }, [entries, selectedRegions, selectedKennels, selectedLevels]);

  const activeFilterCount = selectedRegions.length + selectedKennels.length + selectedLevels.length;

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

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

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
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
          <PopoverContent className="w-56 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search regions..." />
              <CommandList>
                <CommandEmpty>No regions found.</CommandEmpty>
                <CommandGroup>
                  {regions.map((region) => (
                    <CommandItem
                      key={region}
                      onSelect={() => toggleFilter(setSelectedRegions, region)}
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
                      {region}
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
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Kennel
              {selectedKennels.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {selectedKennels.length}
                </Badge>
              )}
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
                      onSelect={() => toggleFilter(setSelectedKennels, kennel.id)}
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
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Level
              {selectedLevels.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {selectedLevels.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-0" align="start">
            <Command>
              <CommandList>
                <CommandGroup>
                  {PARTICIPATION_LEVELS.map((level) => (
                    <CommandItem
                      key={level}
                      onSelect={() => toggleFilter(setSelectedLevels, level)}
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
            onClick={() => {
              setSelectedRegions([]);
              setSelectedKennels([]);
              setSelectedLevels([]);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Count */}
      <p className="text-sm text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? "run" : "runs"}
        {activeFilterCount > 0 ? " (filtered)" : ""}
      </p>

      {/* List */}
      <div className="space-y-1">
        {filtered.map((entry) => (
          <div
            key={entry.attendance.id}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="shrink-0 font-medium sm:w-36">
                {formatDate(entry.event.date)}
              </span>
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
              <span className="hidden sm:block min-w-0 flex-1 truncate text-muted-foreground">
                {entry.event.title || ""}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {entry.attendance.stravaUrl && (
                  <a
                    href={entry.attendance.stravaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    Activity
                  </a>
                )}
                {entry.event.status === "CANCELLED" ? (
                  <span className="flex items-center gap-2">
                    <Badge variant="destructive" className="text-xs">
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
                ) : entry.attendance.status === "INTENDING" &&
                 new Date(entry.event.date).getTime() > todayUtcNoon ? (
                  <Badge
                    variant="outline"
                    className="cursor-pointer border-blue-300 text-blue-700"
                    onClick={() => setEditingAttendance(entry.attendance)}
                  >
                    Going
                  </Badge>
                ) : entry.attendance.status === "INTENDING" ? (
                  <span className="flex items-center gap-1">
                    <Badge
                      variant="outline"
                      className="cursor-pointer border-amber-300 text-amber-700"
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
                      <span className="hidden sm:inline">Confirm Attendance</span>
                      <span className="sm:hidden">Confirm</span>
                    </Badge>
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
                    onClick={() => setEditingAttendance(entry.attendance)}
                  />
                )}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground sm:hidden">
              <RegionBadge region={entry.event.kennel.region} size="sm" />
              {entry.event.runNumber && <span>#{entry.event.runNumber}</span>}
              {entry.event.title && <span className="truncate">{entry.event.title}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Edit dialog */}
      {editingAttendance && (
        <EditAttendanceDialog
          open={!!editingAttendance}
          onOpenChange={(open) => {
            if (!open) setEditingAttendance(null);
          }}
          attendance={editingAttendance}
        />
      )}
    </div>
  );
}
