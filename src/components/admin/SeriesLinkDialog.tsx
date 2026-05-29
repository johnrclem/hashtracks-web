"use client";
/* eslint-disable react-hooks/set-state-in-effect -- debounced search resets + writes results inside effects; key-based remount adds no benefit for this single-instance dialog */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import {
  searchEventsForUmbrella,
  linkChildToUmbrella,
} from "@/app/admin/events/actions";
import { formatDateLong } from "@/lib/format";
import { toast } from "sonner";

interface UmbrellaCandidate {
  id: string;
  date: string;
  kennelName: string;
  title: string | null;
  isSeriesParent: boolean;
}

interface SeriesLinkDialogProps {
  readonly event: {
    readonly id: string;
    readonly title: string | null;
    readonly date: string;
    readonly kennelName: string;
  } | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Admin dialog to attach an event as a child of an umbrella (series parent),
 * #1679. Searches across all events (not just the current page) via the
 * `searchEventsForUmbrella` server action, debounced. Picking a candidate calls
 * `linkChildToUmbrella` and closes on success.
 */
export function SeriesLinkDialog({
  event,
  open,
  onOpenChange,
}: SeriesLinkDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UmbrellaCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Reset state when the dialog opens for a new event.
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
    }
  }, [open, event?.id]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(async () => {
      const r = await searchEventsForUmbrella(q, event?.id);
      if (cancelled) return;
      setSearching(false);
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      setResults(r.events);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, open, event?.id]);

  function handlePick(umbrellaId: string) {
    if (!event) return;
    startTransition(async () => {
      const r = await linkChildToUmbrella(event.id, umbrellaId);
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      toast.success(`Added ${r.kennelName} — ${formatDateLong(r.date)} to the series`);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-muted"
            >
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <DialogTitle>Add to a multi-day series</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            Pick the parent event for the series (the one that spans the whole
            weekend or campout). The event below becomes a day within it.
          </DialogDescription>
        </DialogHeader>

        {event && (
          <div className="rounded-lg border bg-muted/40 p-3 space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Adding this event
            </p>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{event.kennelName}</span>
              <span className="text-sm text-muted-foreground">
                {formatDateLong(event.date)}
              </span>
            </div>
            {event.title && (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {event.title}
              </p>
            )}
          </div>
        )}

        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by title or kennel…"
            value={query}
            onValueChange={setQuery}
            className="text-xs"
          />
          <CommandList>
            <CommandEmpty>
              {searching
                ? "Searching…"
                : query.trim().length < 2
                  ? "Type at least 2 characters."
                  : "No matching events."}
            </CommandEmpty>
            {results.map((r) => (
              <CommandItem
                key={r.id}
                value={r.id}
                disabled={isPending}
                onSelect={() => handlePick(r.id)}
                className="flex items-center gap-2"
              >
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDateLong(r.date)}
                </span>
                <Badge variant="outline" className="text-xs">
                  {r.kennelName}
                </Badge>
                <span className="truncate text-xs">{r.title || "Untitled"}</span>
                {r.isSeriesParent && (
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    existing series
                  </Badge>
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>

        {isPending && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Linking…
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
