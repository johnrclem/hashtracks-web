"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { requestRosterGroupByName } from "@/app/misman/actions";

interface RequestSharedRosterSectionProps {
  kennelShortName: string;
  kennelId: string;
  hasPendingRequest: boolean;
}

export function RequestSharedRosterSection({
  kennelShortName,
  kennelId,
  hasPendingRequest,
}: RequestSharedRosterSectionProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kennelNames, setKennelNames] = useState(kennelShortName);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    startTransition(async () => {
      const result = await requestRosterGroupByName(
        kennelId,
        name,
        kennelNames,
        message || undefined,
      );
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Roster group request submitted — an admin will review it");
        setName("");
        setKennelNames(kennelShortName);
        setMessage("");
        setOpen(false);
        router.refresh();
      }
    });
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setName("");
      setKennelNames(kennelShortName);
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
              <Label htmlFor="rsr-kennels">
                Kennels to include
              </Label>
              <Input
                id="rsr-kennels"
                placeholder="e.g., NYCH3, NYCH4, LBH3"
                value={kennelNames}
                onChange={(e) => setKennelNames(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated kennel short names. You don&apos;t need to manage
                all of them — the admin will coordinate.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rsr-message">Additional details (optional)</Label>
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
              disabled={isPending || !name.trim() || !kennelNames.trim()}
            >
              {isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
