"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  suggestUserLinks,
  createUserLink,
} from "@/app/misman/[slug]/roster/actions";

interface UserActivityItem {
  userId: string;
  hashName: string | null;
  email: string;
  status: string;
  isLinked: boolean;
  linkedHasherId: string | null;
}

interface UserActivitySectionProps {
  userActivity: UserActivityItem[];
  kennelId: string;
  disabled: boolean;
  onRefresh: () => void;
}

export function UserActivitySection({
  userActivity,
  kennelId,
  disabled,
  onRefresh,
}: UserActivitySectionProps) {
  const [isPending, startTransition] = useTransition();
  const [linkingUserId, setLinkingUserId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<
    Array<{
      kennelHasherId: string;
      kennelHasherName: string;
      matchScore: number;
      matchField: string;
    }>
  >([]);

  function handleFindMatch(userId: string) {
    setLinkingUserId(userId);
    startTransition(async () => {
      const result = await suggestUserLinks(kennelId);
      if (result.error) {
        toast.error(result.error);
        setLinkingUserId(null);
        return;
      }
      // Filter to suggestions for this specific user
      const userSuggestions = (result.data ?? []).filter(
        (s) => s.userId === userId,
      );
      if (userSuggestions.length === 0) {
        toast.info("No matching roster entries found for this user");
        setLinkingUserId(null);
      } else {
        setSuggestions(
          userSuggestions.map((s) => ({
            kennelHasherId: s.kennelHasherId,
            kennelHasherName: s.kennelHasherName,
            matchScore: s.matchScore,
            matchField: s.matchField,
          })),
        );
      }
    });
  }

  function handleLink(kennelHasherId: string) {
    if (!linkingUserId) return;
    startTransition(async () => {
      const result = await createUserLink(kennelId, kennelHasherId, linkingUserId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("User linked to roster entry");
        setLinkingUserId(null);
        setSuggestions([]);
        onRefresh();
      }
    });
  }

  function handleCancel() {
    setLinkingUserId(null);
    setSuggestions([]);
  }

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold">User Activity</h4>
        <Badge variant="secondary" className="text-xs">
          {userActivity.length}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Site users who RSVPed or checked in to this event
      </p>
      <div className="space-y-1">
        {userActivity.map((u) => (
          <div
            key={u.userId}
            className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium truncate">
                {u.hashName || u.email}
              </span>
              <Badge
                variant="outline"
                className={
                  u.status === "CONFIRMED"
                    ? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-300"
                    : "border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300"
                }
              >
                {u.status === "CONFIRMED" ? "Checked In" : "Going"}
              </Badge>
              {u.isLinked && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-green-600 dark:text-green-400 cursor-default" tabIndex={0}>Linked</span>
                  </TooltipTrigger>
                  <TooltipContent>This user is linked to a roster entry</TooltipContent>
                </Tooltip>
              )}
            </div>
            {!u.isLinked && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 h-7 text-xs"
                onClick={() => handleFindMatch(u.userId)}
                disabled={disabled || isPending}
              >
                Link to Roster
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Inline matching results */}
      {linkingUserId && suggestions.length > 0 && (
        <div className="border-t pt-2 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Matching roster entries for{" "}
            {userActivity.find((u) => u.userId === linkingUserId)?.hashName || "user"}:
          </p>
          {suggestions.map((s) => (
            <div
              key={s.kennelHasherId}
              className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium">{s.kennelHasherName}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  ({Math.round(s.matchScore * 100)}% via {s.matchField})
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => handleLink(s.kennelHasherId)}
                disabled={isPending}
              >
                Link
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="text-xs"
            onClick={handleCancel}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
