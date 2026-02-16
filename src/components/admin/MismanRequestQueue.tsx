"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveMismanRequest,
  rejectMismanRequest,
} from "@/app/misman/actions";
import { createMismanInvite } from "@/app/misman/invite/actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type MismanRequestRow = {
  id: string;
  user: {
    id: string;
    email: string;
    hashName: string | null;
    nerdName: string | null;
  };
  kennel: { shortName: string; slug: string };
  message: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
};

type KennelOption = {
  id: string;
  shortName: string;
};

interface MismanRequestQueueProps {
  requests: MismanRequestRow[];
  kennels: KennelOption[];
}

export function MismanRequestQueue({ requests, kennels }: MismanRequestQueueProps) {
  return (
    <div>
      <div className="mb-4 flex justify-end">
        <InviteMismanDialog kennels={kennels} />
      </div>
      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No misman requests yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Kennel</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((request) => (
              <MismanRequestRowComponent key={request.id} request={request} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function InviteMismanDialog({ kennels }: { kennels: KennelOption[] }) {
  const [open, setOpen] = useState(false);
  const [kennelId, setKennelId] = useState("");
  const [email, setEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setKennelId("");
    setEmail("");
    setInviteUrl(null);
    setCopied(false);
  }

  function handleGenerate() {
    if (!kennelId) {
      toast.error("Select a kennel");
      return;
    }

    startTransition(async () => {
      const result = await createMismanInvite(
        kennelId,
        email.trim() || undefined,
      );
      if (result.error) {
        toast.error(result.error);
      } else if (result.data) {
        setInviteUrl(result.data.inviteUrl);
        toast.success("Invite link generated");
      }
    });
  }

  async function handleCopy() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Invite Misman</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Misman</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="invite-kennel">Kennel</Label>
            <Select value={kennelId} onValueChange={setKennelId} disabled={!!inviteUrl}>
              <SelectTrigger id="invite-kennel">
                <SelectValue placeholder="Select a kennel" />
              </SelectTrigger>
              <SelectContent>
                {kennels.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.shortName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-email">Email (optional)</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="hasher@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!!inviteUrl}
            />
          </div>

          {!inviteUrl ? (
            <Button
              onClick={handleGenerate}
              disabled={isPending || !kennelId}
              className="w-full"
            >
              {isPending ? "Generating..." : "Generate Invite Link"}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input value={inviteUrl} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={reset}>
                  Create Another
                </Button>
                <Button size="sm" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MismanRequestRowComponent({
  request,
}: {
  request: MismanRequestRow;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const displayName =
    request.user.hashName || request.user.nerdName || request.user.email;

  function handleApprove() {
    startTransition(async () => {
      const result = await approveMismanRequest(request.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(
          `Approved ${displayName} as misman for ${request.kennel.shortName}`,
        );
      }
      router.refresh();
    });
  }

  function handleReject() {
    startTransition(async () => {
      const result = await rejectMismanRequest(request.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Request rejected");
      }
      router.refresh();
    });
  }

  const statusVariant =
    request.status === "APPROVED"
      ? "default"
      : request.status === "REJECTED"
        ? "destructive"
        : "secondary";

  return (
    <TableRow>
      <TableCell>
        <div>
          <span className="font-medium">{displayName}</span>
          {request.user.hashName && (
            <span className="block text-xs text-muted-foreground">
              {request.user.email}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="font-medium">
        {request.kennel.shortName}
      </TableCell>
      <TableCell className="max-w-48 truncate">
        {request.message ?? "—"}
      </TableCell>
      <TableCell>
        <Badge variant={statusVariant}>{request.status}</Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(request.createdAt).toLocaleDateString()}
      </TableCell>
      <TableCell className="text-right">
        {request.status === "PENDING" && (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              disabled={isPending}
              onClick={handleApprove}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={handleReject}
            >
              Reject
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
