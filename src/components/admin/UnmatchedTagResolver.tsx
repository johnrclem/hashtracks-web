"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  createAliasFromAlert,
  createKennelFromAlert,
} from "@/app/admin/alerts/actions";

export interface KennelOption {
  id: string;
  shortName: string;
  score?: number;
}

interface UnmatchedTagResolverProps {
  alertId: string;
  tags: string[];
  suggestions: Record<string, KennelOption[]>; // tag → top kennel matches
  allKennels: { id: string; shortName: string; fullName: string; region: string }[];
}

export function UnmatchedTagResolver({
  alertId,
  tags,
  suggestions,
  allKennels,
}: UnmatchedTagResolverProps) {
  return (
    <div className="mt-2 space-y-3">
      {tags.map((tag) => (
        <TagRow
          key={tag}
          alertId={alertId}
          tag={tag}
          suggestions={suggestions[tag] ?? []}
          allKennels={allKennels}
        />
      ))}
    </div>
  );
}

function TagRow({
  alertId,
  tag,
  suggestions,
  allKennels,
}: {
  alertId: string;
  tag: string;
  suggestions: KennelOption[];
  allKennels: { id: string; shortName: string; fullName: string; region: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"pick" | "create">("pick");
  const [selectedKennelId, setSelectedKennelId] = useState<string>("");
  const [rescrapeAfter, setRescrapeAfter] = useState(true);
  const [resolved, setResolved] = useState(false);

  // New kennel fields
  const [newShortName, setNewShortName] = useState(tag);
  const [newFullName, setNewFullName] = useState("");
  const [newRegion, setNewRegion] = useState("");

  const router = useRouter();

  if (resolved) {
    return (
      <div className="flex items-center gap-2 text-xs text-green-700">
        <Badge variant="outline" className="border-green-300 text-green-700">
          Mapped
        </Badge>
        <span className="font-medium">{tag}</span>
      </div>
    );
  }

  function handleMapToKennel() {
    if (!selectedKennelId) return;
    startTransition(async () => {
      const result = await createAliasFromAlert(
        alertId,
        tag,
        selectedKennelId,
        rescrapeAfter,
      );
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Mapped "${tag}" to kennel`);
        setResolved(true);
        router.refresh();
      }
    });
  }

  function handleCreateKennel() {
    if (!newShortName.trim()) return;
    startTransition(async () => {
      const result = await createKennelFromAlert(
        alertId,
        tag,
        {
          shortName: newShortName.trim(),
          fullName: newFullName.trim(),
          region: newRegion.trim(),
        },
        rescrapeAfter,
      );
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Created kennel "${newShortName}" and mapped "${tag}"`);
        setResolved(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs font-mono">
          {tag}
        </Badge>
        {suggestions.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            Top match: {suggestions[0].shortName} ({Math.round((suggestions[0].score ?? 0) * 100)}%)
          </span>
        )}
      </div>

      {mode === "pick" ? (
        <div className="space-y-2">
          {/* Quick suggestions */}
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestions.slice(0, 5).map((s) => (
                <Button
                  key={s.id}
                  size="sm"
                  variant={selectedKennelId === s.id ? "default" : "outline"}
                  className="h-6 text-[11px]"
                  onClick={() => setSelectedKennelId(s.id)}
                >
                  {s.shortName}
                  <span className="ml-1 opacity-60">
                    {Math.round((s.score ?? 0) * 100)}%
                  </span>
                </Button>
              ))}
            </div>
          )}

          {/* Full kennel selector */}
          <div className="flex items-center gap-2">
            <Select value={selectedKennelId} onValueChange={setSelectedKennelId}>
              <SelectTrigger className="h-7 text-xs w-48">
                <SelectValue placeholder="Select kennel..." />
              </SelectTrigger>
              <SelectContent>
                {allKennels.map((k) => (
                  <SelectItem key={k.id} value={k.id} className="text-xs">
                    {k.shortName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!selectedKennelId || isPending}
              onClick={handleMapToKennel}
            >
              {isPending ? "..." : "Map & Fix"}
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={rescrapeAfter}
                onChange={(e) => setRescrapeAfter(e.target.checked)}
                className="rounded"
              />
              Re-scrape after mapping
            </label>
            <button
              className="text-[11px] text-primary hover:underline"
              onClick={() => setMode("create")}
            >
              Create new kennel instead
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-[10px]">Short Name</Label>
              <Input
                value={newShortName}
                onChange={(e) => setNewShortName(e.target.value)}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">Full Name</Label>
              <Input
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                className="h-7 text-xs"
                placeholder="Optional"
              />
            </div>
            <div>
              <Label className="text-[10px]">Region</Label>
              <Input
                value={newRegion}
                onChange={(e) => setNewRegion(e.target.value)}
                className="h-7 text-xs"
                placeholder="e.g. New York City, NY"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!newShortName.trim() || isPending}
              onClick={handleCreateKennel}
            >
              {isPending ? "..." : "Create & Map"}
            </Button>
            <button
              className="text-[11px] text-muted-foreground hover:underline"
              onClick={() => setMode("pick")}
            >
              Back to existing kennels
            </button>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground ml-auto">
              <input
                type="checkbox"
                checked={rescrapeAfter}
                onChange={(e) => setRescrapeAfter(e.target.checked)}
                className="rounded"
              />
              Re-scrape after
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
