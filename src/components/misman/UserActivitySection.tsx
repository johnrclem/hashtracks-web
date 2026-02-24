"use client";

import { useState, useEffect, useTransition } from "react";
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

export interface UserActivityItem {
  userId: string;
  hashName: string | null;
  email: string;
  status: string;
  isLinked: boolean;
  linkedHasherId: string | null;
}

export type UserActivityState = "addable" | "unlinked" | "already-recorded";

/** Classify a user activity item into one of three states. */
export function classifyUserActivity(
  item: UserActivityItem,
  attendedHasherIds: Set<string>,
): UserActivityState {
  if (item.isLinked && item.linkedHasherId && !attendedHasherIds.has(item.linkedHasherId)) {
    return "addable";
  }
  if (!item.isLinked || !item.linkedHasherId) {
    return "unlinked";
  }
  return "already-recorded";
}

/** Sort user activity items by actionability: addable first, then unlinked, then already-recorded. */
export function sortUserActivity(
  items: UserActivityItem[],
  attendedHasherIds: Set<string>,
): UserActivityItem[] {
  const order: Record<UserActivityState, number> = {
    addable: 0,
    unlinked: 1,
    "already-recorded": 2,
  };
  return [...items].sort(
    (a, b) =>
      order[classifyUserActivity(a, attendedHasherIds)] -
      order[classifyUserActivity(b, attendedHasherIds)],
  );
}

interface UserActivitySectionProps {
  userActivity: UserActivityItem[];
  kennelId: string;
  disabled: boolean;
  onRefresh: () => void;
  attendedHasherIds: Set<string>;
  onAddToAttendance: (kennelHasherId: string) => void;
}

export function UserActivitySection({
  userActivity,
  kennelId,
  disabled,
  onRefresh,
  attendedHasherIds,
  onAddToAttendance,
}: UserActivitySectionProps) {
  const [isPending, startTransition] = useTransition();
  const [linkingUserId, setLinkingUserId] = useState<string | null>(null);
  const [addingHasherId, setAddingHasherId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<
    Array<{
      kennelHasherId: string;
      kennelHasherName: string;
      matchScore: number;
      matchField: string;
    }>
  >([]);

  // Clear addingHasherId once the hasher appears in attendedHasherIds
  useEffect(() => {
    if (addingHasherId && attendedHasherIds.has(addingHasherId)) {
      setAddingHasherId(null);
    }
  }, [addingHasherId, attendedHasherIds]);

  function handleAddToAttendance(linkedHasherId: string) {
    setAddingHasherId(linkedHasherId);
    onAddToAttendance(linkedHasherId);
  }

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

  const sorted = sortUserActivity(userActivity, attendedHasherIds);

  const addableCount = userActivity.filter(
    (u) => classifyUserActivity(u, attendedHasherIds) === "addable",
  ).length;

  const statusBadgeClass = (status: string) =>
    status === "CONFIRMED"
      ? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-300"
      : "border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300";

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold">RSVPs</h4>
        <Badge variant="secondary" className="text-xs">
          {userActivity.length}
        </Badge>
        {addableCount > 0 && (
          <span className="text-xs text-green-600 dark:text-green-400">
            {addableCount} to add
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Tap linked users to record attendance
      </p>
      <div className="space-y-1">
        {sorted.map((u) => {
          const state = classifyUserActivity(u, attendedHasherIds);
          const isAdding = addingHasherId === u.linkedHasherId;

          if (state === "addable") {
            return (
              <button
                key={u.userId}
                className="w-full flex items-center justify-between gap-2 rounded border border-l-2 border-l-green-400 px-3 py-2 text-sm hover:bg-muted transition-colors cursor-pointer text-left"
                onClick={() => handleAddToAttendance(u.linkedHasherId!)}
                disabled={disabled || isPending || isAdding}
                aria-label={`Add ${u.hashName || u.email} to attendance`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium truncate">
                    {u.hashName || u.email}
                  </span>
                  <Badge variant="outline" className={statusBadgeClass(u.status)}>
                    {u.status === "CONFIRMED" ? "Checked In" : "Going"}
                  </Badge>
                </div>
                <span className="text-green-600 dark:text-green-400 text-lg font-bold shrink-0" aria-hidden="true">
                  {isAdding ? "..." : "+"}
                </span>
              </button>
            );
          }

          if (state === "already-recorded") {
            return (
              <div
                key={u.userId}
                className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm bg-muted/50 opacity-60"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium truncate">
                    {u.hashName || u.email}
                  </span>
                  <Badge variant="outline" className={statusBadgeClass(u.status)}>
                    {u.status === "CONFIRMED" ? "Checked In" : "Going"}
                  </Badge>
                </div>
                <span className="text-xs text-green-600 dark:text-green-400 shrink-0">
                  Added
                </span>
              </div>
            );
          }

          // state === "unlinked"
          return (
            <div
              key={u.userId}
              className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium truncate">
                  {u.hashName || u.email}
                </span>
                <Badge variant="outline" className={statusBadgeClass(u.status)}>
                  {u.status === "CONFIRMED" ? "Checked In" : "Going"}
                </Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 h-7 text-xs"
                onClick={() => handleFindMatch(u.userId)}
                disabled={disabled || isPending}
              >
                Link to Roster
              </Button>
            </div>
          );
        })}
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
