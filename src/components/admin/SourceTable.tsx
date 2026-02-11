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
  if (sources.length === 0) {
    return <p className="text-sm text-muted-foreground">No sources yet.</p>;
  }

  return (
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
        {sources.map((source) => (
          <SourceRow
            key={source.id}
            source={source}
            allKennels={allKennels}
          />
        ))}
      </TableBody>
    </Table>
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
        {source.linkedKennels.length}
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
          <PopoverContent align="end" className="w-36 p-1">
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
