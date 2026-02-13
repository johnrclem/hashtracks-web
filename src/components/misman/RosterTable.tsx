"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { deleteKennelHasher } from "@/app/misman/[slug]/roster/actions";
import { HasherForm } from "./HasherForm";

interface HasherRow {
  id: string;
  kennelId: string;
  kennelShortName: string;
  hashName: string | null;
  nerdName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  attendanceCount: number;
}

interface RosterTableProps {
  hashers: HasherRow[];
  kennelId: string;
  kennelSlug: string;
  isSharedRoster: boolean;
}

export function RosterTable({
  hashers,
  kennelId,
  kennelSlug,
  isSharedRoster,
}: RosterTableProps) {
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editHasher, setEditHasher] = useState<HasherRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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

  function handleDelete(hasher: HasherRow) {
    if (
      !confirm(
        `Delete ${hasher.hashName || hasher.nerdName} from the roster?`,
      )
    )
      return;

    setDeletingId(hasher.id);
    startTransition(async () => {
      const result = await deleteKennelHasher(hasher.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Hasher removed from roster");
      }
      setDeletingId(null);
      router.refresh();
    });
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
              <th className="px-3 py-2 text-left font-medium">Hash Name</th>
              <th className="px-3 py-2 text-left font-medium">Nerd Name</th>
              {isSharedRoster && (
                <th className="px-3 py-2 text-left font-medium">Kennel</th>
              )}
              <th className="px-3 py-2 text-right font-medium">Runs</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
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
              filtered.map((h) => (
                <tr key={h.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">
                    <Link
                      href={`/misman/${kennelSlug}/roster/${h.id}`}
                      className="hover:underline"
                    >
                      {h.hashName || (
                        <span className="text-muted-foreground italic">—</span>
                      )}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {h.nerdName || "—"}
                  </td>
                  {isSharedRoster && (
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-xs">
                        {h.kennelShortName}
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
                        onClick={() => handleDelete(h)}
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
    </div>
  );
}
