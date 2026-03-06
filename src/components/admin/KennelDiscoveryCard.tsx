"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  dismissResearchDiscovery,
  linkResearchDiscovery,
} from "@/app/admin/research/actions";
import type { SerializedDiscovery } from "./ResearchDashboard";

interface Props {
  discovery: SerializedDiscovery;
  kennels: { id: string; shortName: string }[];
  onAdd: (discovery: SerializedDiscovery) => void;
}

/** Only allow http/https URLs in href to prevent javascript: XSS. */
function isSafeUrl(url: string): boolean {
  try { return /^https?:$/i.test(new URL(url).protocol); }
  catch { return false; }
}

export function KennelDiscoveryCard({ discovery, kennels, onAdd }: Readonly<Props>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleDismiss() {
    startTransition(async () => {
      const result = await dismissResearchDiscovery(discovery.id);
      if ("error" in result && result.error) toast.error(result.error);
      else router.refresh();
    });
  }

  function handleLink(kennelId: string) {
    startTransition(async () => {
      const result = await linkResearchDiscovery(discovery.id, kennelId);
      if ("error" in result && result.error) toast.error(result.error);
      else {
        toast.success("Linked to kennel");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{discovery.name}</span>
          <Badge variant={discovery.status === "MATCHED" ? "default" : "secondary"}>
            {discovery.status === "MATCHED" ? "Matched" : "New"}
          </Badge>
          {discovery.matchScore != null && discovery.matchScore >= 0.8 && (
            <span className="text-xs text-muted-foreground">
              ~ {discovery.matchedKennelName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          {discovery.location && <span>{discovery.location}</span>}
          {discovery.schedule && <span>{discovery.schedule}</span>}
          {discovery.website && isSafeUrl(discovery.website) && (
            <a
              href={discovery.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline truncate max-w-[200px]"
            >
              {new URL(discovery.website).hostname}
            </a>
          )}
          {discovery.yearStarted && <span>Est. {discovery.yearStarted}</span>}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {discovery.status === "MATCHED" && discovery.matchedKennelId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleLink(discovery.matchedKennelId!)}
            disabled={isPending}
          >
            Confirm
          </Button>
        )}

        {discovery.status === "NEW" && discovery.matchCandidates.length > 0 && (
          <Select
            onValueChange={(value) => handleLink(value)}
            disabled={isPending}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs" aria-label="Link discovery to kennel">
              <SelectValue placeholder="Link..." />
            </SelectTrigger>
            <SelectContent>
              {discovery.matchCandidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.shortName} ({Math.round(c.score * 100)}%)
                </SelectItem>
              ))}
              {kennels.slice(0, 10).map((k) => (
                <SelectItem key={k.id} value={k.id}>{k.shortName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          variant="default"
          size="sm"
          onClick={() => onAdd(discovery)}
          disabled={isPending}
        >
          Add
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          disabled={isPending}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
