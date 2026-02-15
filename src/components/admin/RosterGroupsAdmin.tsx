"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  removeKennelFromGroup,
  renameRosterGroup,
  deleteRosterGroup,
} from "@/app/admin/roster-groups/actions";

interface RosterGroupData {
  id: string;
  name: string;
  kennels: Array<{ id: string; shortName: string; slug: string }>;
  hasherCount: number;
}

interface RosterGroupsAdminProps {
  groups: RosterGroupData[];
}

export function RosterGroupsAdmin({ groups }: RosterGroupsAdminProps) {
  const [deleteTarget, setDeleteTarget] = useState<RosterGroupData | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Separate shared groups (2+ kennels) from standalone (1 kennel)
  const sharedGroups = groups.filter((g) => g.kennels.length > 1);
  const standaloneGroups = groups.filter((g) => g.kennels.length <= 1);

  function handleRemoveKennel(groupId: string, kennelId: string, kennelName: string) {
    if (!confirm(`Remove ${kennelName} from this group? It will get its own standalone roster.`)) {
      return;
    }
    startTransition(async () => {
      const result = await removeKennelFromGroup(groupId, kennelId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`${kennelName} removed from group`);
        router.refresh();
      }
    });
  }

  function handleRename(groupId: string, currentName: string) {
    const newName = prompt("New group name:", currentName);
    if (!newName || newName === currentName) return;
    startTransition(async () => {
      const result = await renameRosterGroup(groupId, newName);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Group renamed");
        router.refresh();
      }
    });
  }

  function handleDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteRosterGroup(deleteTarget.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Group dissolved — kennels are now standalone");
        setDeleteTarget(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Shared groups */}
      <div>
        <h2 className="text-lg font-semibold mb-3">
          Shared Roster Groups ({sharedGroups.length})
        </h2>
        {sharedGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No shared roster groups. Use the admin kennel merge to create one.
          </p>
        ) : (
          <div className="space-y-3">
            {sharedGroups.map((group) => (
              <div key={group.id} className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{group.name}</h3>
                    <Badge variant="secondary">{group.hasherCount} hashers</Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRename(group.id, group.name)}
                      disabled={isPending}
                    >
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setDeleteTarget(group)}
                      disabled={isPending}
                    >
                      Dissolve
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.kennels.map((k) => (
                    <div
                      key={k.id}
                      className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-sm"
                    >
                      {k.shortName}
                      {group.kennels.length > 2 && (
                        <button
                          className="ml-1 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveKennel(group.id, k.id, k.shortName)}
                          disabled={isPending}
                          title="Remove from group"
                        >
                          x
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Standalone groups summary */}
      <div>
        <h2 className="text-lg font-semibold mb-2">
          Standalone Kennels ({standaloneGroups.length})
        </h2>
        <p className="text-sm text-muted-foreground">
          Kennels with their own individual roster. Each gets an auto-created
          single-kennel roster group.
        </p>
      </div>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dissolve Roster Group?</AlertDialogTitle>
            <AlertDialogDescription>
              This will convert each kennel in &ldquo;{deleteTarget?.name}&rdquo; to
              its own standalone roster. Hashers tagged to each kennel will stay
              with their kennel. This cannot be undone easily.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isPending}>
              {isPending ? "Dissolving..." : "Dissolve Group"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
