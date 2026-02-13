"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { requestMismanAccess } from "@/app/misman/actions";

interface MismanAccessButtonProps {
  kennelId: string;
  kennelShortName: string;
  userRole: string | null; // "MEMBER", "MISMAN", "ADMIN", or null (not subscribed)
  hasPendingRequest: boolean;
  isAuthenticated: boolean;
}

export function MismanAccessButton({
  kennelId,
  kennelShortName,
  userRole,
  hasPendingRequest,
  isAuthenticated,
}: MismanAccessButtonProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Not authenticated — don't show
  if (!isAuthenticated) return null;

  // Already misman or admin — show link to dashboard
  if (userRole === "MISMAN" || userRole === "ADMIN") {
    return (
      <Button variant="outline" size="sm" asChild>
        <a href={`/misman`}>Misman Dashboard</a>
      </Button>
    );
  }

  // Has a pending request
  if (hasPendingRequest) {
    return (
      <Badge variant="outline" className="text-xs">
        Misman request pending
      </Badge>
    );
  }

  // Must be subscribed (MEMBER) to request
  if (!userRole) return null;

  function handleSubmit() {
    startTransition(async () => {
      const result = await requestMismanAccess(kennelId, message);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Misman access requested!");
        setOpen(false);
        setMessage("");
      }
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Request Misman Access
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Request Misman Access — {kennelShortName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="misman-message">
                Message (optional)
              </Label>
              <Textarea
                id="misman-message"
                placeholder="I'm the misman for this kennel..."
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
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? "Requesting..." : "Request Access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
