"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function RefreshAllButton() {
  const [isScraping, setIsScraping] = useState(false);
  const router = useRouter();

  async function handleRefreshAll() {
    setIsScraping(true);
    try {
      const res = await fetch("/api/admin/scrape-all", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Refresh failed");
      } else {
        const { summary } = data;
        toast.success(
          `Refresh complete: ${summary.succeeded}/${summary.total} sources succeeded` +
            (summary.failed > 0 ? `, ${summary.failed} failed` : ""),
        );
        if (summary.failed > 0) {
          const failedNames = data.sources
            .filter((s: { success: boolean }) => !s.success)
            .map((s: { name: string }) => s.name)
            .join(", ");
          toast.error(`Failed: ${failedNames}`);
        }
      }
      router.refresh();
    } catch {
      toast.error("Refresh request failed");
    } finally {
      setIsScraping(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={isScraping}
      onClick={handleRefreshAll}
    >
      {isScraping ? "Refreshing..." : "Refresh All"}
    </Button>
  );
}
