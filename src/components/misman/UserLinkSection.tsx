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
} from "@/app/misman/[slug]/roster/actions";

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

interface UserLinkSectionProps {
  kennelId: string;
  kennelHasherId: string;
  userLink: UserLinkData | null;
  hasherDisplayName: string;
}

export function UserLinkSection({
  kennelId,
  kennelHasherId,
  userLink,
  hasherDisplayName,
}: UserLinkSectionProps) {
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleFindLinks() {
    startTransition(async () => {
      const result = await suggestUserLinks(kennelId);
      if (result.error) {
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
      if (result.error) {
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
      if (result.error) {
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
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Link revoked");
        setShowRevokeConfirm(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <h3 className="text-sm font-semibold">User Link</h3>

      {/* No link */}
      {(!userLink || userLink.status === "DISMISSED") && (
        <div className="flex items-center gap-3">
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
