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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  linkedKennels: { id: string; shortName: string }[];
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
          <TableHead className="text-center">Kennels</TableHead>
          <TableHead className="text-center">Raw Events</TableHead>
          <TableHead className="text-right">Actions</TableHead>
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
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeDays, setScrapeDays] = useState("90");
  const router = useRouter();

  function handleDelete() {
    if (!confirm(`Delete source "${source.name}"? This cannot be undone.`)) {
      return;
    }

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

  async function handleScrape(force = false) {
    if (force && !confirm("Force re-scrape will delete all existing raw events for this source and re-scrape from scratch. Continue?")) {
      return;
    }
    setIsScraping(true);
    try {
      const res = await fetch("/api/admin/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: source.id,
          days: parseInt(scrapeDays, 10) || 90,
          force,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Scrape failed");
      } else {
        toast.success(
          `${force ? "Force re-scrape" : "Scrape"} complete: ${data.scrape.eventsFound} found, ${data.merge.created} created, ${data.merge.updated} updated, ${data.merge.skipped} skipped` +
            (data.merge.unmatched.length > 0
              ? `, ${data.merge.unmatched.length} unmatched tags`
              : ""),
        );
        if (data.merge.unmatched.length > 0) {
          toast.info(
            `Unmatched tags: ${data.merge.unmatched.join(", ")}`,
          );
        }
      }
      router.refresh();
    } catch {
      toast.error("Scrape request failed");
    } finally {
      setIsScraping(false);
    }
  }

  return (
    <TableRow>
      <TableCell>
        <div>
          <Link href={`/admin/sources/${source.id}`} className="font-medium hover:underline">
            {source.name}
          </Link>
          <p className="text-xs text-muted-foreground">{source.url}</p>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="text-xs">
          {source.type}
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
        {source.lastScrapeAt
          ? new Date(source.lastScrapeAt).toLocaleString()
          : "Never"}
      </TableCell>
      <TableCell className="text-center">
        {source.linkedKennels.length}
      </TableCell>
      <TableCell className="text-center">{source.rawEventCount}</TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <div className="flex items-center gap-1">
            <Label htmlFor={`days-${source.id}`} className="sr-only">
              Days
            </Label>
            <Input
              id={`days-${source.id}`}
              value={scrapeDays}
              onChange={(e) => setScrapeDays(e.target.value)}
              className="h-8 w-16 text-xs"
              type="number"
              min="1"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={isScraping}
              onClick={() => handleScrape(false)}
            >
              {isScraping ? "..." : "Scrape"}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={isScraping}
              onClick={() => handleScrape(true)}
            >
              Force
            </Button>
          </div>
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
              <Button size="sm" variant="outline">
                Edit
              </Button>
            }
          />
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={handleDelete}
          >
            {isPending ? "..." : "Delete"}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
