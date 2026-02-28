"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  suggestUserLinks,
  createUserLink,
  dismissUserLink,
  revokeUserLink,
  createProfileInvite,
  revokeProfileInvite,
} from "@/app/misman/[slug]/roster/actions";
import { InfoPopover } from "@/components/ui/info-popover";

interface UserLinkData {
  id: string;
  status: string;
  userHashName: string | null;
  userEmail: string;
}

interface LinkSuggestion {
  userId: string;
  userHashName: string | null;
  userEmail: string;
  matchScore: number;
  matchField: string;
}

interface InviteData {
  token: string | null;
  expiresAt: string | null;
}

/** Props for the UserLinkSection — manages linking a KennelHasher to a user account (suggest, invite, revoke). */
interface UserLinkSectionProps {
  kennelId: string;
  kennelHasherId: string;
  /** Existing user link, or null if unlinked. */
  userLink: UserLinkData | null;
  hasherDisplayName: string;
  /** Active profile invite for this hasher (token + expiry). */
  invite: InviteData;
}

export function UserLinkSection({
  kennelId,
  kennelHasherId,
  userLink,
  hasherDisplayName,
  invite: initialInvite,
}: UserLinkSectionProps) {
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [invite, setInvite] = useState(initialInvite);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const hasActiveInvite =
    invite.token !== null &&
    invite.expiresAt !== null &&
    new Date(invite.expiresAt) > new Date();

  function handleFindLinks() {
    startTransition(async () => {
      const result = await suggestUserLinks(kennelId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const matches = (result.data ?? []).filter(
        (s) => s.kennelHasherId === kennelHasherId,
      );
      if (matches.length === 0) {
        toast.info("No matching users found");
      } else {
        setSuggestions(matches);
        setShowSuggestions(true);
      }
    });
  }

  function handleCreateLink(userId: string) {
    startTransition(async () => {
      const result = await createUserLink(kennelId, kennelHasherId, userId);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Link suggestion created");
        setShowSuggestions(false);
        router.refresh();
      }
    });
  }

  function handleDismiss() {
    if (!userLink) return;
    startTransition(async () => {
      const result = await dismissUserLink(kennelId, userLink.id);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Link dismissed");
        router.refresh();
      }
    });
  }

  function handleRevoke() {
    if (!userLink) return;
    startTransition(async () => {
      const result = await revokeUserLink(kennelId, userLink.id);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Link revoked");
        setShowRevokeConfirm(false);
        router.refresh();
      }
    });
  }

  function handleSendInvite() {
    startTransition(async () => {
      const result = await createProfileInvite(kennelId, kennelHasherId);
      if ("error" in result) {
        toast.error(result.error);
      } else if (result.data) {
        setInviteUrl(result.data.inviteUrl);
        setInvite({
          token: result.data.token,
          expiresAt: result.data.expiresAt,
        });
        toast.success("Invite link created");
        router.refresh();
      }
    });
  }

  function handleRevokeInvite() {
    startTransition(async () => {
      const result = await revokeProfileInvite(kennelId, kennelHasherId);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        setInvite({ token: null, expiresAt: null });
        setInviteUrl(null);
        toast.success("Invite revoked");
        router.refresh();
      }
    });
  }

  function handleCopyLink() {
    if (inviteUrl) {
      navigator.clipboard.writeText(inviteUrl);
      toast.success("Link copied to clipboard");
    }
  }

  const isUnlinked = !userLink || userLink.status === "DISMISSED";

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold">User Link</h3>
        <InfoPopover title="User Linking">
          Roster entries exist independently of site accounts. When a hasher
          creates a HashTracks account, you can link them using &ldquo;Find
          Match&rdquo; (searches by name/email) or &ldquo;Send Invite&rdquo;
          (generates a link to share). Once linked, their attendance is
          cross-verified between your records and their check-ins.
        </InfoPopover>
      </div>

      {/* No link */}
      {isUnlinked && !hasActiveInvite && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground">
            Not linked to a site user
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleFindLinks}
            disabled={isPending}
          >
            {isPending ? "Searching..." : "Find Match"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSendInvite}
            disabled={isPending}
          >
            Send Invite
          </Button>
        </div>
      )}

      {/* Active invite pending */}
      {isUnlinked && hasActiveInvite && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300">
              Invite Pending
            </Badge>
            <span className="text-xs text-muted-foreground">
              Expires{" "}
              {new Date(invite.expiresAt!).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
          {inviteUrl && (
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={inviteUrl}
                className="flex-1 rounded border bg-muted px-2 py-1 text-xs font-mono truncate"
              />
              <Button size="sm" variant="outline" onClick={handleCopyLink}>
                Copy
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={handleRevokeInvite}
              disabled={isPending}
            >
              Revoke Invite
            </Button>
          </div>
        </div>
      )}

      {/* Suggested */}
      {userLink && userLink.status === "SUGGESTED" && (
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="secondary">Pending</Badge>
          <span className="text-sm">
            Suggested link to{" "}
            <strong>{userLink.userHashName || userLink.userEmail}</strong>
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={handleDismiss}
            disabled={isPending}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Confirmed */}
      {userLink && userLink.status === "CONFIRMED" && (
        <div className="flex items-center gap-3 flex-wrap">
          <Badge>Linked</Badge>
          <span className="text-sm">
            Linked to{" "}
            <strong>{userLink.userHashName || userLink.userEmail}</strong>
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => setShowRevokeConfirm(true)}
            disabled={isPending}
          >
            Revoke
          </Button>
        </div>
      )}

      {/* Suggestions list */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            Matching users:
          </p>
          {suggestions.map((s) => (
            <div
              key={s.userId}
              className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium">
                  {s.userHashName || s.userEmail}
                </span>
                <span className="text-xs text-muted-foreground ml-2">
                  ({Math.round(s.matchScore * 100)}% match via {s.matchField})
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCreateLink(s.userId)}
                disabled={isPending}
              >
                Link
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Revoke confirmation */}
      <AlertDialog open={showRevokeConfirm} onOpenChange={setShowRevokeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke user link?</AlertDialogTitle>
            <AlertDialogDescription>
              This will unlink <strong>{hasherDisplayName}</strong> from their
              site account. Attendance records will be preserved, but the user
              will no longer see pending confirmations from this roster entry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? "Revoking..." : "Revoke Link"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
