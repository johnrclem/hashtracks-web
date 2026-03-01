"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { requestRosterGroupChange } from "@/app/misman/actions";

interface RosterGroupChangeRequestProps {
  rosterGroupId: string;
  groupName: string;
  kennelId: string;
  hasPendingRequest: boolean;
}

export function RosterGroupChangeRequest({
  rosterGroupId,
  groupName,
  kennelId,
  hasPendingRequest,
}: RosterGroupChangeRequestProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    startTransition(async () => {
      const result = await requestRosterGroupChange(
        rosterGroupId,
        kennelId,
        message,
      );
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Change request submitted — an admin will review it");
        setMessage("");
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (hasPendingRequest) {
    return (
      <Badge variant="outline" className="text-xs shrink-0">
        Change request pending
      </Badge>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-xs text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
        onClick={() => setOpen(true)}
      >
        Request Changes
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Roster Group Changes</DialogTitle>
            <DialogDescription>
              Describe the changes you&apos;d like to make to the &ldquo;{groupName}&rdquo; roster group.
              An admin will review your request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="rg-change-message">
                What would you like changed?
              </Label>
              <Textarea
                id="rg-change-message"
                placeholder="e.g., Remove NYCH4 from the group, rename to 'NYC Weekend', dissolve the group..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isPending || !message.trim()}
            >
              {isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
