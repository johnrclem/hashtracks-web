"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
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
  addKennelToGroup,
  removeKennelFromGroup,
  renameRosterGroup,
  deleteRosterGroup,
  createRosterGroup,
  approveRosterGroupRequest,
  rejectRosterGroupRequest,
} from "@/app/admin/roster-groups/actions";
import { RegionBadge } from "@/components/hareline/RegionBadge";
import { groupByRegion } from "@/lib/groupByRegion";
import { regionNameToData } from "@/lib/region";

type KennelOption = { id: string; shortName: string; fullName: string; region: string };

interface RosterGroupData {
  id: string;
  name: string;
  kennels: Array<KennelOption & { slug: string }>;
  hasherCount: number;
}

function KennelChecklist({ kennels, selectedIds, onToggle, idPrefix, currentIds }: {
  kennels: KennelOption[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  idPrefix: string;
  currentIds?: Set<string>;
}) {
  return (
    <>
      {groupByRegion(kennels).map(({ region, items }) => (
        <div key={region} className="space-y-1.5">
          <div className="flex items-center gap-1.5 pt-1 first:pt-0">
            <RegionBadge regionData={regionNameToData(region)} size="sm" />
            <span className="text-xs font-medium text-muted-foreground">
              {region}
            </span>
          </div>
          {items.map((k) => (
            <div key={k.id} className="flex items-center gap-2 pl-2">
              <Checkbox
                id={`${idPrefix}-${k.id}`}
                checked={selectedIds.has(k.id)}
                onCheckedChange={() => onToggle(k.id)}
              />
              <Label
                htmlFor={`${idPrefix}-${k.id}`}
                className="text-sm font-normal cursor-pointer"
              >
                {k.fullName}
                <span className="ml-1 text-xs text-muted-foreground">
                  ({k.shortName})
                </span>
                {currentIds?.has(k.id) && (
                  <span className="ml-1 text-xs text-muted-foreground">(current)</span>
                )}
              </Label>
            </div>
          ))}
        </div>
      ))}
    </>
  );
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
  const [removeTarget, setRemoveTarget] = useState<{ groupId: string; kennelId: string; kennelName: string } | null>(null);
  const [editTarget, setEditTarget] = useState<RosterGroupData | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [standaloneExpanded, setStandaloneExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Separate shared groups (2+ kennels) from standalone (1 kennel)
  const sharedGroups = groups.filter((g) => g.kennels.length > 1);
  const standaloneGroups = groups.filter((g) => g.kennels.length <= 1);

  function handleRemoveKennel() {
    if (!removeTarget) return;
    startTransition(async () => {
      const result = await removeKennelFromGroup(removeTarget.groupId, removeTarget.kennelId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`${removeTarget.kennelName} removed from group`);
        setRemoveTarget(null);
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
                <div key={req.id} className="rounded-lg border p-3 sm:p-4 space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
                    <div className="flex gap-2 shrink-0">
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
          <div className="py-8 text-center">
            <p className="text-sm font-medium">No shared roster groups</p>
            <p className="text-xs text-muted-foreground mt-1">
              Create a group to share a roster across multiple kennels.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sharedGroups.map((group) => (
              <div key={group.id} className="rounded-lg border p-3 sm:p-4 space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{group.name}</h3>
                    <Badge
                      variant={group.hasherCount === 0 ? "outline" : "secondary"}
                      className={group.hasherCount === 0 ? "text-muted-foreground" : undefined}
                    >
                      {group.hasherCount} hashers
                    </Badge>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditTarget(group)}
                      disabled={isPending}
                    >
                      Edit
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
                          onClick={() => setRemoveTarget({ groupId: group.id, kennelId: k.id, kennelName: k.shortName })}
                          disabled={isPending}
                          title="Remove from group"
                        >
                          &times;
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

      {/* Standalone groups - collapsible list */}
      {standaloneGroups.length > 0 && (
        <div>
          <button
            onClick={() => setStandaloneExpanded((v) => !v)}
            className="flex items-center gap-1.5 w-full text-left"
          >
            {standaloneExpanded ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
            <h2 className="text-lg font-semibold">
              Standalone Kennels ({standaloneGroups.length})
            </h2>
          </button>
          <p className="text-sm text-muted-foreground mt-1 ml-5.5">
            Kennels with their own individual roster.
          </p>
          {standaloneExpanded && (
            <div className="mt-2 ml-5.5 flex flex-wrap gap-1.5">
              {standaloneGroups
                .filter((g) => g.kennels.length === 1)
                .map((g) => (
                  <Badge key={g.id} variant="outline" className="text-xs">
                    {g.kennels[0].shortName}
                  </Badge>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Remove kennel from group confirmation */}
      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(v) => !v && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Kennel from Group?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <strong>{removeTarget?.kennelName}</strong> from
              the group. It will get its own standalone roster.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveKennel} disabled={isPending}>
              {isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* Edit Group dialog */}
      {editTarget && (
        <EditGroupDialog
          group={editTarget}
          standaloneKennels={standaloneGroups
            .filter((g) => g.kennels.length === 1)
            .map((g) => g.kennels[0])}
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}
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
  standaloneKennels: KennelOption[];
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
            <div className="max-h-72 overflow-y-auto space-y-3 rounded-md border p-3">
              {standaloneKennels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No standalone kennels available.
                </p>
              ) : (
                <KennelChecklist
                  kennels={standaloneKennels}
                  selectedIds={selectedIds}
                  onToggle={handleToggle}
                  idPrefix="kennel"
                />
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

function EditGroupDialog({
  group,
  standaloneKennels,
  open,
  onClose,
}: {
  group: RosterGroupData;
  standaloneKennels: KennelOption[];
  open: boolean;
  onClose: () => void;
}) {
  const currentIds = new Set(group.kennels.map((k) => k.id));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(currentIds));
  const [groupName, setGroupName] = useState(group.name);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // All available kennels: current group members + standalone
  const allKennels: KennelOption[] = [
    ...group.kennels.map((k) => ({ id: k.id, shortName: k.shortName, fullName: k.fullName, region: k.region })),
    ...standaloneKennels,
  ];

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

  function handleSave() {
    const toAdd = [...selectedIds].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !selectedIds.has(id));
    const nameChanged = groupName.trim() !== group.name;

    if (toAdd.length === 0 && toRemove.length === 0 && !nameChanged) {
      onClose();
      return;
    }

    startTransition(async () => {
      let hasError = false;

      // Rename if changed
      if (nameChanged && groupName.trim()) {
        const result = await renameRosterGroup(group.id, groupName.trim());
        if (result.error) {
          toast.error(result.error);
          hasError = true;
        }
      }

      if (!hasError) {
        for (const kennelId of toAdd) {
          const result = await addKennelToGroup(group.id, kennelId);
          if (result.error) {
            toast.error(result.error);
            hasError = true;
            break;
          }
        }
      }

      if (!hasError) {
        for (const kennelId of toRemove) {
          const result = await removeKennelFromGroup(group.id, kennelId);
          if (result.error) {
            toast.error(result.error);
            hasError = true;
            break;
          }
        }
      }

      if (!hasError) {
        const changes = [];
        if (nameChanged) changes.push("renamed");
        if (toAdd.length > 0) changes.push(`${toAdd.length} added`);
        if (toRemove.length > 0) changes.push(`${toRemove.length} removed`);
        toast.success(`Group updated (${changes.join(", ")})`);
      }

      if (!hasError) {
        onClose();
      }
      router.refresh();
    });
  }

  function handleOpenChange(v: boolean) {
    if (!v) {
      setSelectedIds(new Set(currentIds));
      setGroupName(group.name);
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {group.name}</DialogTitle>
          <DialogDescription>
            Rename the group or change which kennels are included. Unchecked kennels become standalone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="edit-group-name">Group Name</Label>
            <Input
              id="edit-group-name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Kennels ({selectedIds.size} selected)</Label>
            <div className="max-h-72 overflow-y-auto space-y-3 rounded-md border p-3">
              <KennelChecklist
                kennels={allKennels}
                selectedIds={selectedIds}
                onToggle={handleToggle}
                idPrefix="edit-kennel"
                currentIds={currentIds}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isPending || selectedIds.size < 2 || !groupName.trim()}
          >
            {isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
