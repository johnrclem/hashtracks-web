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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  removeKennelFromGroup,
  renameRosterGroup,
  deleteRosterGroup,
  createRosterGroup,
  approveRosterGroupRequest,
  rejectRosterGroupRequest,
} from "@/app/admin/roster-groups/actions";

interface RosterGroupData {
  id: string;
  name: string;
  kennels: Array<{ id: string; shortName: string; slug: string }>;
  hasherCount: number;
}

interface PendingGroupRequest {
  id: string;
  user: { id: string; email: string; hashName: string | null; nerdName: string | null };
  proposedName: string;
  kennelIds: string[];
  kennelNames: string[];
  message: string | null;
  createdAt: string;
}

interface RosterGroupsAdminProps {
  groups: RosterGroupData[];
  pendingRequests?: PendingGroupRequest[];
}

export function RosterGroupsAdmin({ groups, pendingRequests = [] }: RosterGroupsAdminProps) {
  const [deleteTarget, setDeleteTarget] = useState<RosterGroupData | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
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

  function handleApproveRequest(requestId: string) {
    startTransition(async () => {
      const result = await approveRosterGroupRequest(requestId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Request approved — roster group created");
        router.refresh();
      }
    });
  }

  function handleRejectRequest(requestId: string) {
    startTransition(async () => {
      const result = await rejectRosterGroupRequest(requestId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Request rejected");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Pending requests */}
      {pendingRequests.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            Pending Requests ({pendingRequests.length})
          </h2>
          <div className="space-y-2">
            {pendingRequests.map((req) => {
              const displayName =
                req.user.hashName || req.user.nerdName || req.user.email;
              return (
                <div key={req.id} className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        {displayName}
                        <span className="ml-2 text-sm text-muted-foreground">
                          wants to create &ldquo;{req.proposedName}&rdquo;
                        </span>
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {req.kennelNames.map((name, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {name}
                          </Badge>
                        ))}
                      </div>
                      {req.message && (
                        <p className="mt-1 text-sm text-muted-foreground italic">
                          &ldquo;{req.message}&rdquo;
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleApproveRequest(req.id)}
                        disabled={isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRejectRequest(req.id)}
                        disabled={isPending}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Shared groups */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">
            Shared Roster Groups ({sharedGroups.length})
          </h2>
          {standaloneGroups.length >= 2 && (
            <Button
              size="sm"
              onClick={() => setShowCreateDialog(true)}
              disabled={isPending}
            >
              Create Group
            </Button>
          )}
        </div>
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

      {/* Create Group dialog */}
      <CreateGroupDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        standaloneKennels={standaloneGroups
          .filter((g) => g.kennels.length === 1)
          .map((g) => g.kennels[0])}
      />
    </div>
  );
}

function CreateGroupDialog({
  open,
  onClose,
  standaloneKennels,
}: {
  open: boolean;
  onClose: () => void;
  standaloneKennels: Array<{ id: string; shortName: string }>;
}) {
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleToggle(kennelId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(kennelId)) {
        next.delete(kennelId);
      } else {
        next.add(kennelId);
      }
      return next;
    });
  }

  function handleCreate() {
    startTransition(async () => {
      const result = await createRosterGroup(name, Array.from(selectedIds));
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Roster group created");
        setName("");
        setSelectedIds(new Set());
        onClose();
        router.refresh();
      }
    });
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setName("");
      setSelectedIds(new Set());
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Roster Group</DialogTitle>
          <DialogDescription>
            Select 2 or more standalone kennels to share a roster.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="group-name">Group Name</Label>
            <Input
              id="group-name"
              placeholder="e.g., NYC Metro"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Kennels ({selectedIds.size} selected)</Label>
            <div className="max-h-60 overflow-y-auto space-y-2 rounded-md border p-3">
              {standaloneKennels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No standalone kennels available.
                </p>
              ) : (
                standaloneKennels.map((k) => (
                  <div key={k.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`kennel-${k.id}`}
                      checked={selectedIds.has(k.id)}
                      onCheckedChange={() => handleToggle(k.id)}
                    />
                    <Label
                      htmlFor={`kennel-${k.id}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {k.shortName}
                    </Label>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={isPending || !name.trim() || selectedIds.size < 2}
          >
            {isPending ? "Creating..." : "Create Group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
