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
  linkKennelToSourceDirect,
  createAliasForSource,
  createKennelForSource,
} from "@/app/admin/sources/actions";

interface KennelOption {
  id: string;
  shortName: string;
  score?: number;
}

interface SampleEventActionsProps {
  sourceId: string;
  reason: string;
  kennelTag: string;
  allKennels: { id: string; shortName: string; fullName: string; region: string }[];
  suggestions?: KennelOption[];
}

export function SampleEventActions({
  sourceId,
  reason,
  kennelTag,
  allKennels,
  suggestions = [],
}: SampleEventActionsProps) {
  if (reason === "SOURCE_KENNEL_MISMATCH") {
    return (
      <LinkToSourceAction sourceId={sourceId} kennelTag={kennelTag} />
    );
  }

  if (reason === "UNMATCHED_TAG") {
    return (
      <UnmatchedTagAction
        sourceId={sourceId}
        kennelTag={kennelTag}
        allKennels={allKennels}
        suggestions={suggestions}
      />
    );
  }

  return null;
}

function LinkToSourceAction({
  sourceId,
  kennelTag,
}: {
  sourceId: string;
  kennelTag: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [resolved, setResolved] = useState(false);
  const router = useRouter();

  if (resolved) {
    return (
      <Badge variant="outline" className="text-xs border-green-300 text-green-700">
        Linked
      </Badge>
    );
  }

  function handleLink() {
    startTransition(async () => {
      const result = await linkKennelToSourceDirect(sourceId, kennelTag);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Linked "${kennelTag}" to source`);
        setResolved(true);
        router.refresh();
      }
    });
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs shrink-0"
      disabled={isPending}
      onClick={handleLink}
    >
      {isPending ? "Linking..." : "Link to Source"}
    </Button>
  );
}

function UnmatchedTagAction({
  sourceId,
  kennelTag,
  allKennels,
  suggestions,
}: {
  sourceId: string;
  kennelTag: string;
  allKennels: { id: string; shortName: string; fullName: string; region: string }[];
  suggestions: KennelOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"pick" | "create">("pick");
  const [selectedKennelId, setSelectedKennelId] = useState<string>("");
  const [resolved, setResolved] = useState(false);
  const router = useRouter();

  // New kennel fields
  const [newShortName, setNewShortName] = useState(kennelTag);
  const [newFullName, setNewFullName] = useState("");
  const [newRegion, setNewRegion] = useState("");

  if (resolved) {
    return (
      <Badge variant="outline" className="text-xs border-green-300 text-green-700">
        Mapped
      </Badge>
    );
  }

  function handleMapToKennel() {
    if (!selectedKennelId) return;
    startTransition(async () => {
      const result = await createAliasForSource(sourceId, kennelTag, selectedKennelId);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`Mapped "${kennelTag}" to kennel`);
        setResolved(true);
        router.refresh();
      }
    });
  }

  function handleCreateKennel() {
    if (!newShortName.trim()) return;
    startTransition(async () => {
      const result = await createKennelForSource(sourceId, kennelTag, {
        shortName: newShortName.trim(),
        fullName: newFullName.trim(),
        region: newRegion.trim(),
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`Created kennel "${newShortName}" and mapped "${kennelTag}"`);
        setResolved(true);
        router.refresh();
      }
    });
  }

  if (mode === "pick") {
    return (
      <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-2">
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

        {/* Full kennel selector + action */}
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

        <button
          className="text-[11px] text-primary hover:underline"
          onClick={() => setMode("create")}
        >
          Create new kennel instead
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-2">
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
      </div>
    </div>
  );
}
