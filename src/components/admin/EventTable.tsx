"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  deleteEvent,
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
  kennels: { id: string; shortName: string }[];
  sources: { id: string; name: string }[];
  filters: {
    kennelId?: string;
    sourceId?: string;
    dateStart?: string;
    dateEnd?: string;
  };
  hasFilters: boolean;
  totalCount: number;
}

export function EventTable({
  events,
  kennels,
  sources,
  filters,
  hasFilters,
  totalCount,
}: EventTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [bulkPreview, setBulkPreview] = useState<{
    count: number;
    totalAttendances: number;
    sampleEvents: { id: string; date: string; kennelName: string; title: string | null; attendanceCount: number }[];
  } | null>(null);
  const [showBulkDialog, setShowBulkDialog] = useState(false);

  function updateFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/admin/events?${params.toString()}`);
  }

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
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(
          `Deleted event: ${result.kennelName} ${formatDate(result.date!)}`,
        );
      }
      router.refresh();
    });
  }

  function handleBulkPreview() {
    startTransition(async () => {
      const result = await previewBulkDelete(filters);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setBulkPreview({
        count: result.count!,
        totalAttendances: result.totalAttendances!,
        sampleEvents: result.sampleEvents!,
      });
      setShowBulkDialog(true);
    });
  }

  function handleBulkDelete() {
    startTransition(async () => {
      const result = await bulkDeleteEvents(filters);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Deleted ${result.deletedCount} event(s)`);
        setShowBulkDialog(false);
        setBulkPreview(null);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Kennel</Label>
          <Select
            value={filters.kennelId ?? "all"}
            onValueChange={(v) => updateFilter("kennelId", v)}
          >
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="All kennels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kennels</SelectItem>
              {kennels.map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.shortName}
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
            <SelectTrigger className="w-[200px] h-8 text-xs">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
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
            className="w-[140px] h-8 text-xs"
            value={filters.dateStart ?? ""}
            onChange={(e) => updateFilter("dateStart", e.target.value || undefined)}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            className="w-[140px] h-8 text-xs"
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
              <TableHead>Date</TableHead>
              <TableHead>Kennel</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="text-right">Run #</TableHead>
              <TableHead>Source(s)</TableHead>
              <TableHead className="text-right">Att.</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="text-xs whitespace-nowrap">
                  {formatDate(event.date)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">
                    {event.kennelName}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs max-w-[200px] truncate">
                  {event.title || "—"}
                </TableCell>
                <TableCell className="text-xs text-right">
                  {event.runNumber ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">
                  {event.sources.join(", ") || "—"}
                </TableCell>
                <TableCell className="text-xs text-right">
                  {event.attendanceCount > 0 ? event.attendanceCount : "—"}
                </TableCell>
                <TableCell>
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

      {totalCount > 100 && (
        <p className="text-xs text-muted-foreground text-center">
          Showing first 100 of {totalCount} events. Use filters to narrow results.
        </p>
      )}

      {/* Bulk delete confirmation dialog */}
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
    </div>
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
