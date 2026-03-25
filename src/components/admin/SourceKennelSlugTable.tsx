"use client";

import { useMemo, useState, useRef, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  updateSourceKennelSlug,
  unlinkKennelFromSource,
} from "@/app/admin/sources/actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type LinkedKennel = {
  id: string;
  kennelId: string;
  externalSlug: string | null;
  kennel: { shortName: string; fullName: string; slug: string };
};

interface SourceKennelSlugTableProps {
  sourceId: string;
  kennels: LinkedKennel[];
}

export function SourceKennelSlugTable({
  sourceId,
  kennels,
}: Readonly<SourceKennelSlugTableProps>) {
  const [search, setSearch] = useState("");

  const sorted = useMemo(
    () =>
      [...kennels].sort((a, b) =>
        a.kennel.shortName.localeCompare(b.kennel.shortName),
      ),
    [kennels],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(
      (sk) =>
        sk.kennel.shortName.toLowerCase().includes(q) ||
        sk.kennel.fullName.toLowerCase().includes(q) ||
        (sk.externalSlug && sk.externalSlug.toLowerCase().includes(q)),
    );
  }, [sorted, search]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          Linked Kennels ({kennels.length})
        </h3>
        {kennels.length > 0 && search.trim() && (
          <span className="text-xs text-muted-foreground">
            Showing {filtered.length} of {kennels.length}
          </span>
        )}
      </div>

      {kennels.length > 3 && (
        <Input
          placeholder="Filter by kennel or slug..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-full sm:w-64 text-xs"
        />
      )}

      {kennels.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No kennels linked to this source.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 text-xs">Kennel</TableHead>
              <TableHead className="h-8 text-xs hidden sm:table-cell">
                Full Name
              </TableHead>
              <TableHead className="h-8 text-xs">External Slug</TableHead>
              <TableHead className="h-8 text-xs text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-sm text-muted-foreground py-8"
                >
                  No kennels match your filter.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((sk) => (
                <SlugRow key={sk.id} sourceKennel={sk} />
              ))
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function SlugRow({
  sourceKennel,
}: {
  sourceKennel: LinkedKennel;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(
    sourceKennel.externalSlug ?? "",
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = useCallback(() => {
    setEditValue(sourceKennel.externalSlug ?? "");
    setIsEditing(true);
    // Focus after render
    setTimeout(() => inputRef.current?.select(), 0);
  }, [sourceKennel.externalSlug]);

  function cancelEditing() {
    setIsEditing(false);
    setEditValue(sourceKennel.externalSlug ?? "");
  }

  function saveSlug() {
    if (isPending) return;
    const trimmed = editValue.trim() || null;
    // No change — just close
    if (trimmed === sourceKennel.externalSlug) {
      setIsEditing(false);
      return;
    }

    startTransition(async () => {
      const result = await updateSourceKennelSlug(
        sourceKennel.id,
        trimmed,
      );
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          trimmed
            ? `Slug updated to "${trimmed}"`
            : "Slug cleared",
        );
        setIsEditing(false);
        router.refresh();
      }
    });
  }

  function handleUnlink() {
    startTransition(async () => {
      const result = await unlinkKennelFromSource(sourceKennel.id);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`Unlinked ${sourceKennel.kennel.shortName}`);
        router.refresh();
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveSlug();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEditing();
    }
  }

  return (
    <TableRow>
      <TableCell className="py-1.5 font-medium text-xs">
        <Link
          href={`/kennels/${sourceKennel.kennel.slug}`}
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          {sourceKennel.kennel.shortName}
        </Link>
      </TableCell>
      <TableCell
        className="py-1.5 text-xs hidden sm:table-cell max-w-[200px] truncate"
        title={sourceKennel.kennel.fullName}
      >
        {sourceKennel.kennel.fullName}
      </TableCell>
      <TableCell className="py-1.5 text-xs">
        {isEditing ? (
          <Input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={saveSlug}
            onKeyDown={handleKeyDown}
            className="h-7 w-40 font-mono text-xs"
            disabled={isPending}
            placeholder="slug"
          />
        ) : (
          <button
            type="button"
            onClick={startEditing}
            className="cursor-pointer rounded px-1 py-0.5 font-mono text-xs hover:bg-muted transition-colors"
            title="Click to edit"
          >
            {sourceKennel.externalSlug ?? (
              <span className="text-muted-foreground">&mdash;</span>
            )}
          </button>
        )}
      </TableCell>
      <TableCell className="py-1.5 text-right">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={handleUnlink}
          disabled={isPending}
        >
          {isPending ? "..." : "Unlink"}
        </Button>
      </TableCell>
    </TableRow>
  );
}
