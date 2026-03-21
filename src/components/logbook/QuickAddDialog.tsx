"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchEvents, checkIn } from "@/app/logbook/actions";
import type { SearchEventResult } from "@/app/logbook/actions";
import { formatDateShort } from "@/lib/format";
import { regionAbbrev, regionColorClasses } from "@/lib/format";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  useState,
  useEffect,
  useTransition,
  useCallback,
  useRef,
} from "react";
import { Search, Loader2, Check, ChevronRight } from "lucide-react";

interface QuickAddDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRequestUnlistedRun?: () => void;
}

export function QuickAddDialog({ open, onOpenChange, onRequestUnlistedRun }: QuickAddDialogProps) {
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<SearchEventResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef(0); // monotonic counter to cancel stale fetches

  // Load smart defaults when dialog opens
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setEvents([]);
    setShowDateFilter(false);
    setDateFrom("");
    setDateTo("");
    let cancelled = false;
    setLoading(true);
    searchEvents({}).then((result) => {
      if (cancelled) return;
      if (result.success) setEvents(result.events);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const doSearch = useCallback(
    (q: string, from: string, to: string) => {
      const id = ++abortRef.current;
      setLoading(true);
      searchEvents({
        kennelQuery: q || undefined,
        dateFrom: from || undefined,
        dateTo: to || undefined,
      }).then((result) => {
        if (abortRef.current !== id) return; // stale
        if (result.success) setEvents(result.events);
        setLoading(false);
      });
    },
    [],
  );

  const onQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        doSearch(value, dateFrom, dateTo);
      }, 300);
    },
    [doSearch, dateFrom, dateTo],
  );

  const onDateChange = useCallback(
    (from: string, to: string) => {
      doSearch(query, from, to);
    },
    [doSearch, query],
  );

  const handleCheckIn = useCallback(
    (eventId: string) => {
      startTransition(async () => {
        const result = await checkIn(eventId);
        if (result.success) {
          toast.success("Checked in!");
          // Mark the event as attended in local state
          setEvents((prev) =>
            prev.map((e) =>
              e.id === eventId ? { ...e, alreadyAttended: true } : e,
            ),
          );
          router.refresh();
        } else {
          toast.error(result.error);
        }
      });
    },
    [router],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Add a Run</DialogTitle>
        </DialogHeader>

        {/* Search input */}
        <div className="px-6 pb-3">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="Search kennels..."
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              className="bg-muted pl-9 text-sm"
            />
          </div>
        </div>

        {/* Date filter toggle */}
        <div className="px-6 pb-3">
          <button
            type="button"
            onClick={() => setShowDateFilter((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight
              size={14}
              className={`transition-transform ${showDateFilter ? "rotate-90" : ""}`}
            />
            Filter by date
          </button>
          {showDateFilter && (
            <div className="mt-2 flex gap-2">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  onDateChange(e.target.value, dateTo);
                }}
                className="bg-muted text-xs h-8"
                placeholder="From"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  onDateChange(dateFrom, e.target.value);
                }}
                className="bg-muted text-xs h-8"
                placeholder="To"
              />
            </div>
          )}
        </div>

        {/* Section label */}
        <div className="px-6 pb-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground font-mono">
            {query ? "Search Results" : "Your Recent Events"}
          </span>
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-y-auto px-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-muted-foreground" />
            </div>
          ) : events.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {query
                ? "No events found. Try a different search."
                : "No recent events from your subscribed kennels."}
            </div>
          ) : (
            events.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                onCheckIn={handleCheckIn}
                isPending={isPending}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t bg-muted/50 px-6 py-3 mt-2">
          <button
            type="button"
            onClick={() => {
              onRequestUnlistedRun?.();
            }}
            className="text-sm text-blue-500 hover:text-blue-600 transition-colors"
          >
            Can&apos;t find it? Log an unlisted run
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EventRow({
  event,
  onCheckIn,
  isPending,
}: {
  readonly event: SearchEventResult;
  readonly onCheckIn: (eventId: string) => void;
  readonly isPending: boolean;
}) {
  const abbrev = regionAbbrev(event.region);
  const colorCls = regionColorClasses(event.region);

  return (
    <div className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {formatDateShort(event.date)}
          </span>
          <span className="font-semibold text-sm truncate">
            {event.kennelShortName}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${colorCls}`}
          >
            {abbrev}
          </span>
          {event.runNumber != null && (
            <span className="text-xs text-muted-foreground">
              #{event.runNumber}
            </span>
          )}
        </div>
        {event.title && (
          <p className="mt-0.5 text-xs text-muted-foreground truncate">
            {event.title}
          </p>
        )}
      </div>

      <div className="shrink-0">
        {event.alreadyAttended ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
            <Check size={12} />
            Logged
          </span>
        ) : (
          <Button
            size="sm"
            className="bg-emerald-500 text-white hover:bg-emerald-600 h-7 text-xs px-3"
            onClick={() => onCheckIn(event.id)}
            disabled={isPending}
          >
            I Was There
          </Button>
        )}
      </div>
    </div>
  );
}
