"use client";

import { useState, useTransition, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InfoPopover } from "@/components/ui/info-popover";
import { RegionBadge } from "@/components/hareline/RegionBadge";
import { Users, SearchIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getKennelsForRosterPicker,
  requestRosterGroupWithIds,
} from "@/app/misman/actions";
import { groupByRegion } from "@/lib/groupByRegion";

type PickerKennel = {
  id: string;
  shortName: string;
  fullName: string;
  region: string;
  rosterGroupName: string | null;
};

interface RequestSharedRosterSectionProps {
  kennelId: string;
  hasPendingRequest: boolean;
}

export function RequestSharedRosterSection({
  kennelId,
  hasPendingRequest,
}: RequestSharedRosterSectionProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set([kennelId]),
  );
  const [kennels, setKennels] = useState<PickerKennel[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const fetchKennels = useCallback(async () => {
    setLoading(true);
    const result = await getKennelsForRosterPicker();
    if (result.data) {
      setKennels(result.data);
    }
    setLoading(false);
  }, []);

  function handleOpen() {
    setOpen(true);
    if (kennels.length === 0) {
      fetchKennels();
    }
  }

  function handleToggle(id: string) {
    // Don't allow toggling the current kennel or grouped kennels
    if (id === kennelId) return;
    const kennel = kennels.find((k) => k.id === id);
    if (kennel?.rosterGroupName) return;

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await requestRosterGroupWithIds(
        kennelId,
        name,
        Array.from(selectedIds),
        message || undefined,
      );
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          "Roster group request submitted — an admin will review it",
        );
        setName("");
        setSelectedIds(new Set([kennelId]));
        setMessage("");
        setSearch("");
        setOpen(false);
        router.refresh();
      }
    });
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setName("");
      setSelectedIds(new Set([kennelId]));
      setMessage("");
      setSearch("");
      setOpen(false);
    }
  }

  const grouped = useMemo(() => {
    const searchLower = search.toLowerCase();
    const filtered = search
      ? kennels.filter(
          (k) =>
            k.shortName.toLowerCase().includes(searchLower) ||
            k.fullName.toLowerCase().includes(searchLower) ||
            k.region.toLowerCase().includes(searchLower),
        )
      : kennels;
    return groupByRegion(filtered);
  }, [kennels, search]);

  return (
    <div className="rounded-lg border border-dashed border-muted-foreground/25 p-3">
      <div className="flex items-start gap-2">
        <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">
              Shared Roster
            </span>
            <InfoPopover title="Shared Roster">
              If your kennel has sister kennels with overlapping hashers, you
              can request a shared roster. This means one unified roster across
              multiple kennels — no duplicate entries for hashers who attend
              more than one. Attendance is still tracked per kennel.
            </InfoPopover>
          </div>
          <p className="text-xs text-muted-foreground">
            Do you share hashers with sister kennels? A shared roster avoids
            duplicate entries and keeps one unified list.
          </p>
          {hasPendingRequest ? (
            <Badge variant="outline" className="text-xs mt-1">
              Request pending
            </Badge>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={handleOpen}
            >
              Request Shared Roster
            </Button>
          )}
        </div>
      </div>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Request Shared Roster</DialogTitle>
            <DialogDescription>
              Propose grouping kennels to share a roster. An admin will review
              your request and set up the group.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="rsr-group-name">Group Name</Label>
              <Input
                id="rsr-group-name"
                placeholder="e.g., NYC Metro"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Kennels ({selectedIds.size} selected)</Label>
              <div className="rounded-md border">
                <div className="flex items-center border-b px-3">
                  <SearchIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                  <input
                    className="flex h-9 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
                    placeholder="Search kennels..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-72 overflow-y-auto p-3 space-y-3">
                  {loading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : grouped.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      {search ? "No kennels match your search." : "No kennels available."}
                    </p>
                  ) : (
                    grouped.map(({ region, items }) => (
                      <div key={region} className="space-y-1.5">
                        <div className="flex items-center gap-1.5 pt-1 first:pt-0">
                          <RegionBadge region={region} size="sm" />
                          <span className="text-xs font-medium text-muted-foreground">
                            {region}
                          </span>
                        </div>
                        {items.map((k) => {
                          const isCurrentKennel = k.id === kennelId;
                          const isInGroup = !!k.rosterGroupName;
                          const isDisabled = isCurrentKennel || isInGroup;
                          const isChecked =
                            selectedIds.has(k.id) || isCurrentKennel;

                          return (
                            <div
                              key={k.id}
                              className="flex items-center gap-2 pl-2"
                            >
                              <Checkbox
                                id={`rsr-kennel-${k.id}`}
                                checked={isChecked}
                                disabled={isDisabled}
                                onCheckedChange={() => handleToggle(k.id)}
                              />
                              <Label
                                htmlFor={`rsr-kennel-${k.id}`}
                                className={`text-sm font-normal cursor-pointer flex-1 ${
                                  isInGroup ? "text-muted-foreground" : ""
                                }`}
                              >
                                {k.fullName}
                                <span className="ml-1 text-xs text-muted-foreground">
                                  ({k.shortName})
                                </span>
                              </Label>
                              {isCurrentKennel && (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] px-1.5 py-0"
                                >
                                  Current
                                </Badge>
                              )}
                              {isInGroup && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1.5 py-0 text-muted-foreground"
                                >
                                  In: {k.rosterGroupName}
                                </Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rsr-message">
                Additional details (optional)
              </Label>
              <Textarea
                id="rsr-message"
                placeholder="Why should these kennels share a roster?"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isPending || !name.trim() || selectedIds.size < 2}
            >
              {isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
