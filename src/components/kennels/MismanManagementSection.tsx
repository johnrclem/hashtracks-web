"use client";

import { useState, useTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Copy, UserPlus, X } from "lucide-react";
import {
  createMismanInvite,
  revokeMismanInvite,
  listMismanInvites,
  getKennelMismans,
} from "@/app/misman/invite/actions";

interface MismanManagementSectionProps {
  kennelId: string;
  kennelShortName: string;
}

interface MismanMember {
  userId: string;
  hashName: string | null;
  email: string;
  role: string;
  since: string;
}

interface InviteRecord {
  id: string;
  inviteeEmail: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  inviterName: string;
  acceptorName: string | null;
}

export function MismanManagementSection({
  kennelId,
  kennelShortName,
}: MismanManagementSectionProps) {
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inviteeEmail, setInviteeEmail] = useState("");
  const [expiryDays, setExpiryDays] = useState(7);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  const [mismans, setMismans] = useState<MismanMember[]>([]);
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadData();
  }, [kennelId]);

  function loadData() {
    startTransition(async () => {
      const [mismanResult, inviteResult] = await Promise.all([
        getKennelMismans(kennelId),
        listMismanInvites(kennelId),
      ]);
      if (mismanResult.data) setMismans(mismanResult.data);
      if (inviteResult.data) setInvites(inviteResult.data);
      setLoaded(true);
    });
  }

  function handleGenerate() {
    startTransition(async () => {
      const result = await createMismanInvite(
        kennelId,
        inviteeEmail || undefined,
        expiryDays,
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.data) {
        setGeneratedUrl(result.data.inviteUrl);
        toast.success("Invite link generated");
        loadData();
      }
    });
  }

  function handleCopy() {
    if (generatedUrl) {
      navigator.clipboard.writeText(generatedUrl);
      toast.success("Link copied to clipboard");
    }
  }

  function handleRevoke(inviteId: string) {
    startTransition(async () => {
      const result = await revokeMismanInvite(inviteId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Invite revoked");
        loadData();
      }
    });
  }

  function handleCloseDialog() {
    setDialogOpen(false);
    setInviteeEmail("");
    setGeneratedUrl(null);
  }

  if (!loaded) {
    return (
      <div className="rounded-lg border p-4">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const statusColor: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    ACCEPTED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    EXPIRED: "bg-muted text-muted-foreground",
    REVOKED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Misman Team</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialogOpen(true)}
        >
          <UserPlus className="h-3.5 w-3.5 mr-1" />
          Invite
        </Button>
      </div>

      {/* Team list */}
      <div className="space-y-1">
        {mismans.map((m) => (
          <div key={m.userId} className="flex items-center justify-between text-sm">
            <span>{m.hashName || m.email}</span>
            <Badge variant="outline" className="text-xs">
              {m.role}
            </Badge>
          </div>
        ))}
        {mismans.length === 0 && (
          <p className="text-xs text-muted-foreground">No team members found.</p>
        )}
      </div>

      {/* Invite list */}
      {invites.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Invites</h3>
          {invites.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${statusColor[inv.status] || ""}`}
                >
                  {inv.status}
                </span>
                <span className="text-muted-foreground">
                  {inv.inviteeEmail || "No email"}
                </span>
                {inv.acceptorName && (
                  <span className="text-muted-foreground">
                    — {inv.acceptorName}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">
                  {new Date(inv.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                {inv.status === "PENDING" && (
                  <button
                    onClick={() => handleRevoke(inv.id)}
                    className="ml-1 rounded p-0.5 text-muted-foreground hover:text-destructive"
                    disabled={isPending}
                    title="Revoke invite"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Generate invite dialog */}
      <Dialog open={dialogOpen} onOpenChange={handleCloseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Misman — {kennelShortName}</DialogTitle>
          </DialogHeader>

          {!generatedUrl ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="invite-email">
                  Email (optional — for your records)
                </Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="invitee@example.com"
                  value={inviteeEmail}
                  onChange={(e) => setInviteeEmail(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="invite-expiry">Link expires in</Label>
                <select
                  id="invite-expiry"
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(parseInt(e.target.value, 10))}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                >
                  <option value={1}>1 day</option>
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={handleCloseDialog}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button onClick={handleGenerate} disabled={isPending}>
                  {isPending ? "Generating..." : "Generate Link"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Share this link with the person you want to invite:
              </p>
              <div className="flex gap-2">
                <Input
                  value={generatedUrl}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button variant="outline" size="icon" onClick={handleCopy}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This link is single-use and expires in {expiryDays} day{expiryDays !== 1 ? "s" : ""}.
              </p>
              <DialogFooter>
                <Button onClick={handleCloseDialog}>Done</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
