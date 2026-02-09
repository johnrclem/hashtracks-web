"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSource } from "@/app/admin/sources/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SourceForm } from "./SourceForm";
import { toast } from "sonner";

type SourceDetailData = {
  id: string;
  name: string;
  url: string;
  type: string;
  trustLevel: number;
  scrapeFreq: string;
  linkedKennelIds: string[];
};

interface SourceDetailActionsProps {
  source: SourceDetailData;
  allKennels: { id: string; shortName: string }[];
}

export function SourceDetailActions({
  source,
  allKennels,
}: SourceDetailActionsProps) {
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
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Label htmlFor="scrape-days" className="sr-only">
          Days
        </Label>
        <Input
          id="scrape-days"
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
        source={source}
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
  );
}
