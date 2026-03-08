"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getHashRegoDriftPreview,
  syncHashRegoDrift,
  type DriftPreview,
} from "@/app/admin/sources/actions";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

export function SlugDriftSync({ sourceId }: Readonly<{ sourceId: string }>) {
  const [preview, setPreview] = useState<DriftPreview | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isSyncing, startSync] = useTransition();
  const router = useRouter();

  function handlePreview() {
    startLoading(async () => {
      try {
        const data = await getHashRegoDriftPreview(sourceId);
        setPreview(data);
      } catch {
        toast.error("Failed to load preview");
      }
    });
  }

  function handleSync() {
    startSync(async () => {
      try {
        const result = await syncHashRegoDrift(sourceId);
        const parts: string[] = [];
        if (result.linksCreated > 0) parts.push(`${result.linksCreated} link(s) created`);
        if (result.slugsAdded > 0) parts.push(`${result.slugsAdded} slug(s) added to config`);
        if (result.unlinked > 0) parts.push(`${result.unlinked} orphan(s) unlinked`);
        if (result.unresolved.length > 0) {
          parts.push(`${result.unresolved.length} unresolved: ${result.unresolved.join(", ")}`);
        }
        toast.success(parts.length ? `Sync: ${parts.join(", ")}` : "Already in sync");
        setPreview(null);
        router.refresh();
      } catch {
        toast.error("Sync failed");
      }
    });
  }

  if (!preview) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="mt-2 border-yellow-500 text-yellow-800 hover:bg-yellow-100 dark:text-yellow-200 dark:hover:bg-yellow-900/40"
        disabled={isLoading}
        onClick={handlePreview}
      >
        {isLoading ? "Loading..." : "Preview Sync"}
      </Button>
    );
  }

  const hasFixable =
    preview.slugsWithoutLink.some((s) => s.kennelId) ||
    preview.linksWithoutSlug.length > 0;

  return (
    <div className="mt-3 space-y-3">
      {/* Slugs without link */}
      {preview.slugsWithoutLink.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-yellow-800 dark:text-yellow-200">
            Config slugs missing SourceKennel link (will create links):
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-7 text-xs">Slug</TableHead>
                <TableHead className="h-7 text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.slugsWithoutLink.map((s) => (
                <TableRow key={s.slug}>
                  <TableCell className="py-1 font-mono text-xs">{s.slug}</TableCell>
                  <TableCell className="py-1 text-xs">
                    {s.kennelId ? (
                      <span className="text-green-700 dark:text-green-400">Will link</span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">No matching kennel</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Links without slug */}
      {preview.linksWithoutSlug.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-yellow-800 dark:text-yellow-200">
            Linked kennels missing from config.kennelSlugs:
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-7 text-xs">Hash Rego Slug</TableHead>
                <TableHead className="h-7 text-xs">HashTracks</TableHead>
                <TableHead className="h-7 text-xs">Full Name</TableHead>
                <TableHead className="h-7 text-xs">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.linksWithoutSlug.map((row) => (
                <TableRow key={row.kennelId}>
                  <TableCell className="py-1 font-mono text-xs">
                    {row.hashRegoSlug ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="py-1 font-mono text-xs">{row.shortName}</TableCell>
                  <TableCell className="py-1 text-xs">{row.fullName}</TableCell>
                  <TableCell className="py-1 text-xs">
                    {row.hashRegoSlug ? (
                      <span className="text-green-700 dark:text-green-400">Add slug</span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">Unlink</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="border-yellow-500 text-yellow-800 hover:bg-yellow-100 dark:text-yellow-200 dark:hover:bg-yellow-900/40"
          disabled={isSyncing || !hasFixable}
          onClick={handleSync}
        >
          {isSyncing ? "Syncing..." : "Apply Sync"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setPreview(null)}
          disabled={isSyncing}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
