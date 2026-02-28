"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { deleteKennelHasher } from "@/app/misman/[slug]/roster/actions";
import { HasherForm } from "./HasherForm";

interface HasherRow {
  id: string;
  kennelId: string | null;
  kennelShortName: string | null;
  hashName: string | null;
  nerdName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  attendanceCount: number;
  linkStatus?: string | null;
}

interface RosterTableProps {
  hashers: HasherRow[];
  kennelId: string;
  kennelSlug: string;
  isSharedRoster: boolean;
}

type SortKey = "hashName" | "kennelShortName" | "attendanceCount";
type SortDir = "asc" | "desc";

export function RosterTable({
  hashers,
  kennelId,
  kennelSlug,
  isSharedRoster,
}: RosterTableProps) {
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editHasher, setEditHasher] = useState<HasherRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HasherRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("hashName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const filtered = hashers.filter((h) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      h.hashName?.toLowerCase().includes(q) ||
      h.nerdName?.toLowerCase().includes(q) ||
      h.email?.toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "hashName") {
      cmp = (a.hashName ?? "").localeCompare(b.hashName ?? "");
    } else if (sortKey === "kennelShortName") {
      cmp = (a.kennelShortName ?? "").localeCompare(b.kennelShortName ?? "");
    } else if (sortKey === "attendanceCount") {
      cmp = a.attendanceCount - b.attendanceCount;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function handleDelete() {
    if (!deleteTarget) return;

    setDeletingId(deleteTarget.id);
    startTransition(async () => {
      const result = await deleteKennelHasher(deleteTarget.id);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Hasher removed from roster");
      }
      setDeletingId(null);
      setDeleteTarget(null);
      router.refresh();
    });
  }

  function sortIndicator(key: SortKey) {
    if (sortKey === key) return sortDir === "asc" ? " \u25B2" : " \u25BC";
    return " \u21C5";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search roster..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Button onClick={() => setShowAdd(true)}>Add Hasher</Button>
        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length} hasher{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left font-medium">
                <button
                  className="flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort("hashName")}
                >
                  Hash Name
                  <span className="text-xs">{sortIndicator("hashName")}</span>
                </button>
              </th>
              <th className="px-3 py-2 text-left font-medium">Nerd Name</th>
              {isSharedRoster && (
                <th className="px-3 py-2 text-left font-medium">
                  <button
                    className="flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort("kennelShortName")}
                  >
                    Kennel
                    <span className="text-xs">
                      {sortIndicator("kennelShortName")}
                    </span>
                  </button>
                </th>
              )}
              <th className="px-3 py-2 text-right font-medium">
                <button
                  className="flex items-center gap-1 ml-auto hover:text-foreground"
                  onClick={() => toggleSort("attendanceCount")}
                >
                  Runs
                  <span className="text-xs">
                    {sortIndicator("attendanceCount")}
                  </span>
                </button>
              </th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={isSharedRoster ? 5 : 4}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  {search
                    ? "No hashers match your search"
                    : "No hashers in the roster yet"}
                </td>
              </tr>
            ) : (
              sorted.map((h) => (
                <tr key={h.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/misman/${kennelSlug}/roster/${h.id}`}
                        className="hover:underline"
                      >
                        {h.hashName || (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </Link>
                      {h.linkStatus === "CONFIRMED" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-green-600 cursor-default" tabIndex={0}>L</span>
                          </TooltipTrigger>
                          <TooltipContent>Linked — this hasher is connected to a site account</TooltipContent>
                        </Tooltip>
                      )}
                      {h.linkStatus === "SUGGESTED" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-yellow-600 cursor-default" tabIndex={0}>P</span>
                          </TooltipTrigger>
                          <TooltipContent>Pending — a link to a site account has been suggested</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {h.nerdName || "—"}
                  </td>
                  {isSharedRoster && (
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-xs">
                        {h.kennelShortName ?? "—"}
                      </Badge>
                    </td>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {h.attendanceCount}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditHasher(h)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setDeleteTarget(h)}
                        disabled={isPending && deletingId === h.id}
                      >
                        {isPending && deletingId === h.id
                          ? "..."
                          : "Delete"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Hasher Dialog */}
      <HasherForm
        open={showAdd}
        onClose={() => setShowAdd(false)}
        kennelId={kennelId}
        kennelSlug={kennelSlug}
      />

      {/* Edit Hasher Dialog */}
      {editHasher && (
        <HasherForm
          open={true}
          onClose={() => setEditHasher(null)}
          kennelId={kennelId}
          kennelSlug={kennelSlug}
          hasher={editHasher}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from roster?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove{" "}
              <strong>
                {deleteTarget?.hashName || deleteTarget?.nerdName}
              </strong>{" "}
              from the roster? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending && deletingId === deleteTarget?.id
                ? "Removing..."
                : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
