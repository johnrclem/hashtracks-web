"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAttendanceHistory } from "@/app/misman/[slug]/history/actions";

interface Attendee {
  id: string;
  hashName: string | null;
  nerdName: string | null;
  paid: boolean;
  haredThisTrail: boolean;
  isVirgin: boolean;
  isVisitor: boolean;
}

interface EventSummary {
  id: string;
  date: string;
  title: string | null;
  runNumber: number | null;
  kennelShortName: string;
  attendeeCount: number;
  paidCount: number;
  hareCount: number;
  virginCount: number;
  visitorCount: number;
  attendees: Attendee[];
}

interface HistoryListProps {
  initialEvents: EventSummary[];
  initialTotal: number;
  initialPage: number;
  pageSize: number;
  totalPages: number;
  kennelId: string;
}

export function HistoryList({
  initialEvents,
  initialTotal,
  initialPage,
  pageSize,
  totalPages: initialTotalPages,
  kennelId,
}: HistoryListProps) {
  const [events, setEvents] = useState(initialEvents);
  const [page, setPage] = useState(initialPage);
  const [total, setTotal] = useState(initialTotal);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isPending, startTransition] = useTransition();

  function fetchPage(newPage: number, start?: string, end?: string) {
    startTransition(async () => {
      const result = await getAttendanceHistory(kennelId, {
        page: newPage,
        pageSize,
        startDate: start || startDate || undefined,
        endDate: end || endDate || undefined,
      });
      if (result.data) {
        setEvents(result.data);
        setPage(result.page);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      }
    });
  }

  function handleFilter() {
    fetchPage(1, startDate, endDate);
  }

  function handleClearFilter() {
    setStartDate("");
    setEndDate("");
    fetchPage(1, "", "");
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

  if (events.length === 0 && !startDate && !endDate) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground">
        No attendance has been recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Date filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-40"
          placeholder="Start date"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="w-40"
          placeholder="End date"
        />
        <Button size="sm" onClick={handleFilter} disabled={isPending}>
          Filter
        </Button>
        {(startDate || endDate) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleClearFilter}
            disabled={isPending}
          >
            Clear
          </Button>
        )}
        <span className="ml-auto text-sm text-muted-foreground">
          {total} event{total !== 1 ? "s" : ""} with attendance
        </span>
      </div>

      {/* Event list */}
      <div className="space-y-2">
        {events.map((event) => (
          <div key={event.id} className="rounded-lg border">
            <button
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
              onClick={() =>
                setExpandedId(expandedId === event.id ? null : event.id)
              }
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {event.runNumber ? `#${event.runNumber}` : ""}
                    {event.runNumber && event.title ? " — " : ""}
                    {event.title || (event.runNumber ? "" : "Untitled")}
                  </span>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {event.kennelShortName}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  {formatDate(event.date)}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="secondary">
                  {event.attendeeCount}
                </Badge>
                {event.paidCount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {event.paidCount} paid
                  </span>
                )}
                <span className="text-muted-foreground">
                  {expandedId === event.id ? "▲" : "▼"}
                </span>
              </div>
            </button>

            {expandedId === event.id && (
              <div className="border-t px-4 py-3">
                {/* Event stats */}
                <div className="mb-3 flex flex-wrap gap-2 text-xs">
                  {event.hareCount > 0 && (
                    <Badge variant="outline">
                      {event.hareCount} hare{event.hareCount !== 1 ? "s" : ""}
                    </Badge>
                  )}
                  {event.virginCount > 0 && (
                    <Badge variant="outline">
                      {event.virginCount} virgin{event.virginCount !== 1 ? "s" : ""}
                    </Badge>
                  )}
                  {event.visitorCount > 0 && (
                    <Badge variant="outline">
                      {event.visitorCount} visitor{event.visitorCount !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>

                {/* Attendee list */}
                <div className="space-y-1">
                  {event.attendees.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span>
                        {a.hashName || a.nerdName || "Unknown"}
                        {a.hashName && a.nerdName && (
                          <span className="text-muted-foreground">
                            {" "}({a.nerdName})
                          </span>
                        )}
                      </span>
                      <div className="flex gap-1 ml-auto">
                        {a.paid && (
                          <span className="text-xs text-green-600" title="Paid">$</span>
                        )}
                        {a.haredThisTrail && (
                          <span className="text-xs text-orange-600" title="Hare">H</span>
                        )}
                        {a.isVirgin && (
                          <span className="text-xs text-purple-600" title="Virgin">V</span>
                        )}
                        {a.isVisitor && (
                          <span className="text-xs text-blue-600" title="Visitor">Vis</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1 || isPending}
            onClick={() => fetchPage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages || isPending}
            onClick={() => fetchPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
