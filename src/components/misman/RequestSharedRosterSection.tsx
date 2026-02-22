"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InfoPopover } from "@/components/ui/info-popover";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { requestRosterGroup } from "@/app/misman/actions";

interface RequestSharedRosterSectionProps {
  kennels: { id: string; shortName: string }[];
  hasPendingRequest: boolean;
}

export function RequestSharedRosterSection({
  kennels,
  hasPendingRequest,
}: RequestSharedRosterSectionProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleToggle(kennelId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(kennelId)) {
        next.delete(kennelId);
      } else {
        next.add(kennelId);
      }
      return next;
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await requestRosterGroup(
        name,
        Array.from(selectedIds),
        message || undefined,
      );
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Roster group request submitted — an admin will review it");
        setName("");
        setSelectedIds(new Set());
        setMessage("");
        setOpen(false);
        router.refresh();
      }
    });
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setName("");
      setSelectedIds(new Set());
      setMessage("");
      setOpen(false);
    }
  }

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
              If you manage sister kennels with overlapping hashers, you can
              request a shared roster. This means one unified roster across
              multiple kennels — no duplicate entries for hashers who attend
              more than one. Attendance is still tracked per kennel.
            </InfoPopover>
          </div>
          <p className="text-xs text-muted-foreground">
            You manage {kennels.length} kennels. If they share many of the same
            hashers, a shared roster avoids duplicate entries.
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
              onClick={() => setOpen(true)}
            >
              Request Shared Roster
            </Button>
          )}
        </div>
      </div>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Shared Roster</DialogTitle>
            <DialogDescription>
              Propose grouping 2 or more of your kennels to share a roster.
              An admin will review your request.
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
              <div className="space-y-2 rounded-md border p-3">
                {kennels.map((k) => (
                  <div key={k.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`rsr-kennel-${k.id}`}
                      checked={selectedIds.has(k.id)}
                      onCheckedChange={() => handleToggle(k.id)}
                    />
                    <Label
                      htmlFor={`rsr-kennel-${k.id}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {k.shortName}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rsr-message">Message (optional)</Label>
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
