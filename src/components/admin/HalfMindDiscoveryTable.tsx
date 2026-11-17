"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ExternalLink, Link as LinkIcon, Plus, RefreshCw, Undo2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RegionCombobox, type RegionOption } from "./RegionCombobox";
import {
  addListingOnlyKennel,
  dismissHalfMindListing,
  linkHalfMindListing,
  runHalfMindSync,
  unlinkHalfMindListing,
} from "@/app/admin/discovery/half-mind-actions";
import {
  adminKennelStatusHref,
  halfMindRowActions,
  halfMindStatusBadge,
  nearestRegionId,
  searchKennels,
} from "@/lib/admin/half-mind-review";
import { safeUrl } from "@/lib/safe-url";

export type HalfMindRow = {
  id: string;
  externalSlug: string;
  name: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  schedule: string | null;
  externalUrl: string | null;
  externalStatus: string | null;
  externalCheckedAt: string | null;
  website: string | null;
  facebookUrl: string | null;
  status: string;
  matchCandidates: Array<{ id: string; shortName: string; score: number }> | null;
  matchedKennel: { id: string; shortName: string; slug: string } | null;
};

export type PickerKennel = { id: string; shortName: string; fullName: string; region: string };
export type CentroidRegion = RegionOption & { centroidLat: number | null; centroidLng: number | null };

type Tab = "NEW" | "LINKED" | "ADDED" | "DISMISSED" | "ALL";
const TABS: { key: Tab; label: string }[] = [
  { key: "NEW", label: "Needs Review" },
  { key: "LINKED", label: "Linked" },
  { key: "ADDED", label: "Added" },
  { key: "DISMISSED", label: "Dismissed" },
  { key: "ALL", label: "All" },
];

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatChecked(iso: string | null): string {
  if (!iso) return "never checked";
  return `checked ${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

interface Props {
  rows: HalfMindRow[];
  regions: CentroidRegion[];
  kennels: PickerKennel[];
}

export function HalfMindDiscoveryTable({ rows, regions, kennels }: Readonly<Props>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("NEW");
  const [linking, setLinking] = useState<HalfMindRow | null>(null);
  const [adding, setAdding] = useState<HalfMindRow | null>(null);

  const visible = tab === "ALL" ? rows : rows.filter((r) => r.status === tab);

  /** Run a server action, toast its outcome and refresh. */
  function run(fn: () => Promise<{ error?: string; warning?: string } | { success: true }>, ok: string, after?: () => void) {
    startTransition(async () => {
      try {
        const result = await fn();
        if ("error" in result && result.error) {
          toast.error(result.error);
          return;
        }
        const warning = "warning" in result ? result.warning : undefined;
        if (warning) toast.warning(warning);
        else toast.success(ok);
        after?.();
        router.refresh();
      } catch (err) {
        toast.error(errorText(err));
      }
    });
  }

  function handleSync() {
    startTransition(async () => {
      try {
        const result = await runHalfMindSync();
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        const { success: _ok, ...counts } = result;
        toast.success(
          Object.entries(counts)
            .filter(([, v]) => typeof v === "number")
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ") || "Half-Mind sync finished",
        );
        router.refresh();
      } catch (err) {
        toast.error(errorText(err));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleSync} disabled={isPending} size="sm">
          <RefreshCw className={`mr-2 h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
          Sync Half-Mind (pilot)
        </Button>
        <span className="text-sm text-muted-foreground">Fetches the pilot scopes from Half-Mind&apos;s finder</span>
      </div>

      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => {
          const n = t.key === "ALL" ? rows.length : rows.filter((r) => r.status === t.key).length;
          return (
            <Button key={t.key} variant={tab === t.key ? "default" : "outline"} size="sm" onClick={() => setTab(t.key)}>
              {t.label}
              {n > 0 && (
                <Badge variant={tab === t.key ? "secondary" : "outline"} className="ml-1.5">
                  {n}
                </Badge>
              )}
            </Button>
          );
        })}
      </div>

      <div className="rounded-md border divide-y">
        {visible.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">No Half-Mind rows in this category</p>
        )}
        {visible.map((r) => (
          <HalfMindRowView
            key={r.id}
            row={r}
            isPending={isPending}
            onLink={() => setLinking(r)}
            onAdd={() => setAdding(r)}
            onDismiss={() => run(() => dismissHalfMindListing(r.id), "Dismissed")}
            onUnlink={() => run(() => unlinkHalfMindListing(r.id), "Unlinked")}
          />
        ))}
      </div>

      <LinkDialog
        row={linking}
        kennels={kennels}
        isPending={isPending}
        onClose={() => setLinking(null)}
        onPick={(kennelId) =>
          linking && run(() => linkHalfMindListing(linking.id, kennelId), "Linked to kennel", () => setLinking(null))
        }
      />
      <AddDialog
        row={adding}
        regions={regions}
        isPending={isPending}
        onClose={() => setAdding(null)}
        onDone={() => {
          setAdding(null);
          router.refresh();
        }}
        startTransition={startTransition}
      />
    </div>
  );
}

function HalfMindRowView({
  row: r,
  isPending,
  onLink,
  onAdd,
  onDismiss,
  onUnlink,
}: Readonly<{
  row: HalfMindRow;
  isPending: boolean;
  onLink: () => void;
  onAdd: () => void;
  onDismiss: () => void;
  onUnlink: () => void;
}>) {
  const actions = halfMindRowActions(r.status);
  const badge = halfMindStatusBadge(r.status, r.externalStatus);
  const website = safeUrl(r.website);
  const facebook = safeUrl(r.facebookUrl);
  const listing = safeUrl(r.externalUrl);

  return (
    <div className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{r.name}</span>
          <Badge variant="outline">{r.status}</Badge>
          {r.externalStatus && <Badge variant="secondary">{r.externalStatus}</Badge>}
          {badge && r.matchedKennel && (
            <Link href={adminKennelStatusHref(r.matchedKennel.shortName)}>
              <Badge variant="destructive">{badge}</Badge>
            </Link>
          )}
          {badge && !r.matchedKennel && <Badge variant="destructive">{badge}</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {r.location && <span>{r.location}</span>}
          <span>{formatChecked(r.externalCheckedAt)}</span>
          {listing && (
            <a href={listing} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:underline">
              Half-Mind listing <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {website && (
            <a href={website} target="_blank" rel="noopener noreferrer" className="hover:underline">
              Website
            </a>
          )}
          {facebook && (
            <a href={facebook} target="_blank" rel="noopener noreferrer" className="hover:underline">
              Facebook
            </a>
          )}
        </div>
        {r.schedule && <p className="text-xs text-muted-foreground">{r.schedule}</p>}
        {r.status === "NEW" && (
          <p className="text-xs">
            {r.matchCandidates && r.matchCandidates.length > 0
              ? r.matchCandidates.map((c) => `${c.shortName} (${Math.min(100, Math.round(c.score * 100))}%)`).join(" · ")
              : "No candidates"}
          </p>
        )}
        {r.matchedKennel && r.status !== "NEW" && (
          <p className="text-xs">
            Kennel: <span className="font-medium">{r.matchedKennel.shortName}</span>
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions.includes("link") && (
          <Button variant="outline" size="sm" onClick={onLink} disabled={isPending}>
            <LinkIcon className="mr-1 h-3 w-3" /> Link
          </Button>
        )}
        {actions.includes("add") && (
          <Button variant="outline" size="sm" onClick={onAdd} disabled={isPending}>
            <Plus className="mr-1 h-3 w-3" /> Add as listing-only kennel
          </Button>
        )}
        {actions.includes("dismiss") && (
          <Button variant="ghost" size="sm" onClick={onDismiss} disabled={isPending}>
            <X className="mr-1 h-3 w-3" /> Dismiss
          </Button>
        )}
        {actions.includes("unlink") && (
          <Button variant="outline" size="sm" onClick={onUnlink} disabled={isPending}>
            <Undo2 className="mr-1 h-3 w-3" /> Unlink
          </Button>
        )}
        {actions.includes("view-kennel") && r.matchedKennel && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={adminKennelStatusHref(r.matchedKennel.shortName)}>Open in admin</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function LinkDialog({
  row,
  kennels,
  isPending,
  onClose,
  onPick,
}: Readonly<{
  row: HalfMindRow | null;
  kennels: PickerKennel[];
  isPending: boolean;
  onClose: () => void;
  onPick: (kennelId: string) => void;
}>) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchKennels(kennels, query), [kennels, query]);
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link {row?.name}</DialogTitle>
          <DialogDescription>Pick a candidate, or search any kennel by name.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {row?.matchCandidates?.map((c) => (
            <Button key={c.id} variant="outline" size="sm" className="justify-start" disabled={isPending} onClick={() => onPick(c.id)}>
              {c.shortName} ({Math.min(100, Math.round(c.score * 100))}%)
            </Button>
          ))}
          <Input placeholder="Search kennels by name..." value={query} onChange={(e) => setQuery(e.target.value)} />
          {query.trim() && results.length === 0 && <p className="text-xs text-muted-foreground">No kennels match.</p>}
          {results.map((k) => (
            <Button key={k.id} variant="ghost" size="sm" className="justify-start" disabled={isPending} onClick={() => onPick(k.id)}>
              {k.shortName} <span className="ml-2 text-xs text-muted-foreground">{k.region}</span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddDialog({
  row,
  regions,
  isPending,
  onClose,
  onDone,
  startTransition,
}: Readonly<{
  row: HalfMindRow | null;
  regions: CentroidRegion[];
  isPending: boolean;
  onClose: () => void;
  onDone: () => void;
  startTransition: (fn: () => Promise<void>) => void;
}>) {
  // Re-key the form on the row so the prefill resets per listing.
  return row ? (
    <AddForm
      key={row.id}
      row={row}
      regions={regions}
      isPending={isPending}
      onClose={onClose}
      onDone={onDone}
      startTransition={startTransition}
    />
  ) : null;
}

function AddForm({
  row,
  regions,
  isPending,
  onClose,
  onDone,
  startTransition,
}: Readonly<{
  row: HalfMindRow;
  regions: CentroidRegion[];
  isPending: boolean;
  onClose: () => void;
  onDone: () => void;
  startTransition: (fn: () => Promise<void>) => void;
}>) {
  const [shortName, setShortName] = useState(row.name);
  const [fullName, setFullName] = useState(row.name);
  const [regionId, setRegionId] = useState(nearestRegionId(row.latitude, row.longitude, regions) ?? "");
  const [duplicate, setDuplicate] = useState<string | null>(null);

  function submit() {
    startTransition(async () => {
      try {
        const result = await addListingOnlyKennel(
          row.id,
          { shortName, fullName, regionId },
          { confirmNotDuplicate: duplicate !== null },
        );
        if ("error" in result) {
          if (result.duplicateOf) {
            const pct = Math.min(100, Math.round(result.duplicateOf.score * 100));
            setDuplicate(`Looks like ${result.duplicateOf.shortName} (${pct}%). Add anyway?`);
          } else {
            toast.error(result.error);
          }
          return;
        }
        // As for link: a warning says the kennel was created but no check was recorded.
        if (result.warning) toast.warning(result.warning);
        else toast.success(`Kennel "${shortName}" created`);
        onDone();
      } catch (err) {
        toast.error(errorText(err));
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add as listing-only kennel</DialogTitle>
          <DialogDescription>Prefilled from the Half-Mind listing. Edit before creating.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="hm-short">Short Name</Label>
            <Input id="hm-short" value={shortName} onChange={(e) => { setShortName(e.target.value); setDuplicate(null); }} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="hm-full">Full Name</Label>
            <Input id="hm-full" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Region</Label>
            <RegionCombobox value={regionId} regions={regions} onSelect={setRegionId} />
          </div>
          {duplicate && <p className="rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-800">{duplicate}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending || !shortName.trim() || !fullName.trim() || !regionId}>
            {duplicate ? "Add anyway" : "Create Kennel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
