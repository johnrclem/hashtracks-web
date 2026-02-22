"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSource } from "@/app/admin/sources/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { SourceForm } from "./SourceForm";
import { toast } from "sonner";

type SourceDetailData = {
  id: string;
  name: string;
  url: string;
  type: string;
  trustLevel: number;
  scrapeFreq: string;
  scrapeDays: number;
  config: unknown;
  linkedKennelIds: string[];
};

interface SourceDetailActionsProps {
  source: SourceDetailData;
  allKennels: { id: string; shortName: string; fullName: string; region: string }[];
}

export function SourceDetailActions({
  source,
  allKennels,
}: SourceDetailActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeDays, setScrapeDays] = useState(String(source.scrapeDays));
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
        router.push("/admin/sources");
      }
    });
  }

  async function handleScrape(force = false) {
    if (
      force &&
      !confirm(
        "Force re-scrape will delete all existing raw events for this source and re-scrape from scratch. Continue?",
      )
    ) {
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
          `${force ? "Force re-scrape" : "Scrape"} complete: ${data.eventsFound} found, ${data.created} created, ${data.updated} updated, ${data.skipped} skipped` +
            (data.unmatched?.length > 0
              ? `, ${data.unmatched.length} unmatched tags`
              : ""),
        );
        if (data.unmatched?.length > 0) {
          toast.info(
            `Unmatched tags: ${data.unmatched.join(", ")}`,
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
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground">Lookback:</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Input
              id="scrape-days"
              value={scrapeDays}
              onChange={(e) => setScrapeDays(e.target.value)}
              className="h-8 w-16 text-xs"
              type="number"
              min="1"
            />
          </TooltipTrigger>
          <TooltipContent>Days to look back (applied on next scrape, not auto-saved)</TooltipContent>
        </Tooltip>
        <span className="text-sm text-muted-foreground">days</span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            disabled={isScraping}
            onClick={() => handleScrape(false)}
          >
            {isScraping ? "..." : "Scrape"}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Run scraper (skips unchanged events)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-300 text-amber-700 hover:bg-amber-50"
            disabled={isScraping}
            onClick={() => handleScrape(true)}
          >
            Force
          </Button>
        </TooltipTrigger>
        <TooltipContent>Re-scrape all events from scratch</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <SourceForm
              source={source}
              allKennels={allKennels}
              trigger={
                <Button size="sm" variant="outline">
                  Edit
                </Button>
              }
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>Edit source configuration</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={handleDelete}
          >
            {isPending ? "..." : "Delete"}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Delete source and scrape history</TooltipContent>
      </Tooltip>
    </div>
  );
}
