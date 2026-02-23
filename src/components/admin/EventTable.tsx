"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  deleteEvent,
  deleteSelectedEvents,
  bulkDeleteEvents,
  previewBulkDelete,
} from "@/app/admin/events/actions";

interface EventData {
  id: string;
  date: string;
  kennelId: string;
  kennelName: string;
  kennelRegion: string | null;
  title: string | null;
  runNumber: number | null;
  startTime: string | null;
  status: string;
  sources: string[];
  rawEventCount: number;
  attendanceCount: number;
  hareCount: number;
}

interface EventTableProps {
  events: EventData[];
  kennels: { id: string; shortName: string; fullName: string; region: string }[];
  sources: { id: string; name: string }[];
  filters: {
    kennelId?: string;
    sourceId?: string;
    dateStart?: string;
    dateEnd?: string;
    sortBy?: string;
    sortDir?: string;
  };
  hasFilters: boolean;
  totalCount: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;
}

type SortableColumn = "date" | "kennelName" | "title" | "runNumber" | "attendanceCount";

/** Build updated URL search params for filter changes. */
function buildFilterParams(
  searchParams: URLSearchParams,
  key: string,
  value: string | undefined,
): string {
  const params = new URLSearchParams(searchParams.toString());
  if (value && value !== "all") {
    params.set(key, value);
  } else {
    params.delete(key);
  }
  params.set("page", "1");
  return params.toString();
}

/** Build updated URL search params for sort changes. */
function buildSortParams(
  searchParams: URLSearchParams,
  column: SortableColumn,
  currentSort: string,
  currentDir: string,
): string {
  const params = new URLSearchParams(searchParams.toString());
  if (currentSort === column) {
    params.set("sortDir", currentDir === "asc" ? "desc" : "asc");
  } else {
    params.set("sortBy", column);
    params.set("sortDir", column === "date" ? "desc" : "asc");
  }
  params.set("page", "1");
  return params.toString();
}

export function EventTable({
  events,
  kennels,
  sources,
  filters,
  hasFilters,
  totalCount,
  currentPage,
  pageSize,
  totalPages,
}: EventTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [showSelectedDialog, setShowSelectedDialog] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<{
    count: number;
    totalAttendances: number;
    sampleEvents: { id: string; date: string; kennelName: string; title: string | null; attendanceCount: number }[];
  } | null>(null);

  // Clear selection when URL params change (page navigation, filter change)
  useEffect(() => {
    setSelectedIds(new Set());
  }, [searchParams]);

  function updateFilter(key: string, value: string | undefined) {
    router.push(`/admin/events?${buildFilterParams(searchParams, key, value)}`);
  }

  function updateSort(column: SortableColumn) {
    const currentSort = filters.sortBy ?? "date";
    const currentDir = filters.sortDir ?? "desc";
    router.push(`/admin/events?${buildSortParams(searchParams, column, currentSort, currentDir)}`);
  }

  function updatePage(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));
    router.push(`/admin/events?${params.toString()}`);
  }

  function updatePageSize(size: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pageSize", size);
    params.set("page", "1");
    router.push(`/admin/events?${params.toString()}`);
  }

  // Selection helpers
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === events.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(events.map((e) => e.id)));
    }
  }

  // Delete handlers
  function handleDelete(event: EventData) {
    if (
      !confirm(
        `Delete "${event.title || "Untitled"}" (${event.kennelName}, ${formatDate(event.date)})?\n\n` +
          `This will unlink ${event.rawEventCount} raw event(s) and delete ${event.attendanceCount} attendance record(s).`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await deleteEvent(event.id);
      if (!result.success) {
        toast.error(result.error);
      } else {
        toast.success(
          `Deleted event: ${result.kennelName} ${formatDate(result.date)}`,
        );
      }
      router.refresh();
    });
  }

  function handleBulkPreview() {
    startTransition(async () => {
      const result = await previewBulkDelete(filters);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setBulkPreview({
        count: result.count,
        totalAttendances: result.totalAttendances,
        sampleEvents: result.sampleEvents,
      });
      setShowBulkDialog(true);
    });
  }

  function handleBulkDelete() {
    startTransition(async () => {
      const result = await bulkDeleteEvents(filters);
      if (!result.success) {
        toast.error(result.error);
      } else {
        toast.success(`Deleted ${result.deletedCount} event(s)`);
        setShowBulkDialog(false);
        setBulkPreview(null);
      }
      router.refresh();
    });
  }

  function handleSelectedDelete() {
    startTransition(async () => {
      const result = await deleteSelectedEvents(Array.from(selectedIds));
      if (!result.success) {
        toast.error(result.error);
      } else {
        toast.success(`Deleted ${result.deletedCount} event(s)`);
        setSelectedIds(new Set());
        setShowSelectedDialog(false);
      }
      router.refresh();
    });
  }

  // Sort header helper
  const activeSortBy = filters.sortBy ?? "date";
  const activeSortDir = filters.sortDir ?? "desc";

  function SortHeader({ column, label, className }: { column: SortableColumn; label: string; className?: string }) {
    const isActive = activeSortBy === column;
    return (
      <TableHead className={className}>
        <button
          className="flex items-center gap-1 cursor-pointer select-none hover:text-foreground"
          onClick={() => updateSort(column)}
        >
          {label}
          {isActive && (
            activeSortDir === "asc"
              ? <ArrowUp className="size-3" />
              : <ArrowDown className="size-3" />
          )}
        </button>
      </TableHead>
    );
  }

  // Checkbox state
  const allSelected = events.length > 0 && selectedIds.size === events.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < events.length;

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Kennel</Label>
            <Select
              value={filters.kennelId ?? "all"}
              onValueChange={(v) => updateFilter("kennelId", v)}
            >
              <SelectTrigger className="w-full sm:w-[280px] h-8 text-xs">
                <SelectValue placeholder="All kennels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All kennels</SelectItem>
                {kennels.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    <span className="font-medium">{k.shortName}</span>
                    <span className="ml-1 text-muted-foreground">— {k.fullName}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Source</Label>
            <Select
              value={filters.sourceId ?? "all"}
              onValueChange={(v) => updateFilter("sourceId", v)}
            >
              <SelectTrigger className="w-full sm:w-[200px] h-8 text-xs">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="none">No source</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              className="w-full sm:w-[140px] h-8 text-xs"
              value={filters.dateStart ?? ""}
              onChange={(e) => updateFilter("dateStart", e.target.value || undefined)}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              className="w-full sm:w-[140px] h-8 text-xs"
              value={filters.dateEnd ?? ""}
              onChange={(e) => updateFilter("dateEnd", e.target.value || undefined)}
            />
          </div>

          {hasFilters && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => router.push("/admin/events")}
              >
                Clear
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                disabled={isPending}
                onClick={handleBulkPreview}
              >
                {isPending ? "..." : `Delete ${totalCount} matching`}
              </Button>
            </>
          )}
        </div>

        {/* Table */}
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {hasFilters
              ? "No events match these filters."
              : "No events in the database."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <SortHeader column="date" label="Date" />
                <SortHeader column="kennelName" label="Kennel" />
                <SortHeader column="title" label="Title" />
                <SortHeader column="runNumber" label="Run #" className="hidden sm:table-cell text-right w-16" />
                <TableHead className="hidden md:table-cell">Source(s)</TableHead>
                <SortHeader column="attendanceCount" label="Att." className="hidden sm:table-cell text-right w-16" />
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow
                  key={event.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest("button") || target.closest("[role=checkbox]")) return;
                    router.push(`/hareline/${event.id}`);
                  }}
                >
                  <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(event.id)}
                      onCheckedChange={() => toggleSelect(event.id)}
                      aria-label={`Select ${event.title || "event"}`}
                    />
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {formatDate(event.date)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {event.kennelName}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs max-w-[200px] sm:max-w-[300px] truncate">
                    {event.title ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block truncate">{event.title}</span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-sm">
                          {event.title}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-xs text-right w-16">
                    {event.runNumber ?? "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-[180px] truncate">
                    {event.sources.length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block truncate">{event.sources.join(", ")}</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {event.sources.join(", ")}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-xs text-right w-16">
                    {event.attendanceCount > 0 ? event.attendanceCount : "—"}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      disabled={isPending}
                      onClick={() => handleDelete(event)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Selection action bar */}
        {selectedIds.size > 0 && (
          <div className="sticky bottom-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg border bg-background p-3 shadow-md">
            <span className="text-sm text-muted-foreground">
              {selectedIds.size} event{selectedIds.size !== 1 ? "s" : ""} selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                disabled={isPending}
                onClick={() => setShowSelectedDialog(true)}
              >
                {isPending ? "Deleting..." : `Delete selected (${selectedIds.size})`}
              </Button>
            </div>
          </div>
        )}

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between py-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Per page</Label>
              <Select
                value={String(pageSize)}
                onValueChange={updatePageSize}
              >
                <SelectTrigger className="w-[70px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 200].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={currentPage <= 1}
                onClick={() => updatePage(currentPage - 1)}
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={currentPage >= totalPages}
                onClick={() => updatePage(currentPage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Bulk delete (filter-based) confirmation dialog */}
        <Dialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Bulk Delete</DialogTitle>
              <DialogDescription>
                This action cannot be undone. RawEvents will be preserved but
                unlinked.
              </DialogDescription>
            </DialogHeader>

            {bulkPreview && (
              <div className="space-y-3 text-sm">
                <div className="flex gap-4">
                  <div>
                    <div className="text-muted-foreground text-xs">Events</div>
                    <div className="text-lg font-semibold">{bulkPreview.count}</div>
                  </div>
                  {bulkPreview.totalAttendances > 0 && (
                    <div>
                      <div className="text-muted-foreground text-xs">
                        Attendance records
                      </div>
                      <div className="text-lg font-semibold text-destructive">
                        {bulkPreview.totalAttendances}
                      </div>
                    </div>
                  )}
                </div>

                {bulkPreview.sampleEvents.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">
                      Sample events:
                    </div>
                    {bulkPreview.sampleEvents.map((e) => (
                      <div
                        key={e.id}
                        className="text-xs flex gap-2 text-muted-foreground"
                      >
                        <span>{formatDate(e.date)}</span>
                        <span className="font-medium">{e.kennelName}</span>
                        <span className="truncate">{e.title || "Untitled"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBulkDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={handleBulkDelete}
              >
                {isPending
                  ? "Deleting..."
                  : `Delete ${bulkPreview?.count ?? 0} events`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Selected delete confirmation dialog */}
        <Dialog open={showSelectedDialog} onOpenChange={setShowSelectedDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Selected Events</DialogTitle>
              <DialogDescription>
                This will delete {selectedIds.size} selected event{selectedIds.size !== 1 ? "s" : ""}.
                RawEvents will be preserved but unlinked. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSelectedDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={handleSelectedDelete}
              >
                {isPending
                  ? "Deleting..."
                  : `Delete ${selectedIds.size} event${selectedIds.size !== 1 ? "s" : ""}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
