"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { RegionCombobox, type RegionOption } from "./RegionCombobox";
import {
  runDiscoverySync,
  linkDiscoveryToKennel,
  addKennelFromDiscovery,
  dismissDiscovery,
  undismissDiscovery,
  confirmMatch,
  getDiscoveryPrefill,
} from "@/app/admin/discovery/actions";
import {
  RefreshCw,
  ExternalLink,
  Check,
  X,
  Undo2,
  Plus,
  Link as LinkIcon,
  ChevronDown,
  Search,
  Globe,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { safeUrl } from "@/lib/safe-url";

type DiscoveryRecord = {
  id: string;
  externalSource: string;
  externalSlug: string;
  name: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  schedule: string | null;
  externalUrl: string | null;
  website: string | null;
  contactEmail: string | null;
  yearStarted: number | null;
  trailPrice: number | null;
  memberCount: number | null;
  status: string;
  matchedKennelId: string | null;
  matchScore: number | null;
  matchCandidates: Array<{ id: string; shortName: string; score: number }> | null;
  matchedKennel: { id: string; shortName: string; slug: string } | null;
  lastSeenAt: string;
  createdAt: string;
};

type StatusCounts = {
  total: number;
  new: number;
  matched: number;
  addedLinked: number;
  dismissed: number;
};

type FilterTab = "review" | "matched" | "done" | "dismissed" | "all";

interface DiscoveryTableProps {
  discoveries: DiscoveryRecord[];
  regions: RegionOption[];
  counts: StatusCounts;
}

const STATUS_BADGES: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
  NEW: { variant: "default", label: "New" },
  MATCHED: { variant: "secondary", label: "Auto-Matched" },
  ADDED: { variant: "outline", label: "Added" },
  LINKED: { variant: "outline", label: "Linked" },
  DISMISSED: { variant: "destructive", label: "Dismissed" },
};

export function DiscoveryTable({ discoveries, regions, counts }: DiscoveryTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<FilterTab>("review");
  const [search, setSearch] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addingDiscovery, setAddingDiscovery] = useState<DiscoveryRecord | null>(null);
  const [addForm, setAddForm] = useState({
    shortName: "",
    fullName: "",
    regionId: "",
    website: "",
    contactEmail: "",
    foundedYear: "",
    hashCash: "",
    scheduleDayOfWeek: "",
    scheduleFrequency: "",
    paymentLink: "",
  });

  const filtered = useMemo(() => {
    let items = discoveries;

    // Filter by tab
    switch (filter) {
      case "review":
        items = items.filter((d) => d.status === "NEW");
        break;
      case "matched":
        items = items.filter((d) => d.status === "MATCHED");
        break;
      case "done":
        items = items.filter((d) => d.status === "ADDED" || d.status === "LINKED");
        break;
      case "dismissed":
        items = items.filter((d) => d.status === "DISMISSED");
        break;
    }

    // Filter by search
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.externalSlug.toLowerCase().includes(q) ||
          (d.location?.toLowerCase().includes(q) ?? false),
      );
    }

    return items;
  }, [discoveries, filter, search]);

  function handleSync() {
    startTransition(async () => {
      try {
        const result = await runDiscoverySync();
        if ("error" in result) {
          toast.error(result.error);
        } else if (result.totalDiscovered === 0 && result.errors?.length) {
          toast.error(result.errors[0]);
        } else {
          if (result.errors?.length) {
            toast.warning(`${result.errors.length} enrichment error(s) — check console`);
            console.warn("[DiscoverySync] errors:", result.errors);
          }
          toast.success(
            `Discovered ${result.totalDiscovered} kennels: ${result.newKennels} new, ${result.autoMatched} auto-matched, ${result.enriched} enriched`,
          );
          router.refresh();
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function handleLink(discoveryId: string, kennelId: string) {
    startTransition(async () => {
      try {
        const result = await linkDiscoveryToKennel(discoveryId, kennelId);
        if ("error" in result) toast.error(result.error);
        else {
          toast.success("Linked to kennel");
          router.refresh();
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function handleDismiss(id: string) {
    startTransition(async () => {
      try {
        const result = await dismissDiscovery(id);
        if ("error" in result) toast.error(result.error);
        else router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function handleUndismiss(id: string) {
    startTransition(async () => {
      try {
        const result = await undismissDiscovery(id);
        if ("error" in result) toast.error(result.error);
        else router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function handleConfirm(id: string) {
    startTransition(async () => {
      try {
        const result = await confirmMatch(id);
        if ("error" in result) toast.error(result.error);
        else {
          toast.success("Match confirmed");
          router.refresh();
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function openAddDialog(discovery: DiscoveryRecord) {
    setAddingDiscovery(discovery);

    try {
      const result = await getDiscoveryPrefill(discovery.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      const p = result.prefill!;
      setAddForm({
        shortName: p.shortName || "",
        fullName: p.fullName || "",
        regionId: p.suggestedRegionId || "",
        website: p.website || "",
        contactEmail: p.contactEmail || "",
        foundedYear: p.foundedYear?.toString() || "",
        hashCash: p.hashCash || "",
        scheduleDayOfWeek: p.scheduleDayOfWeek || "",
        scheduleFrequency: p.scheduleFrequency || "",
        paymentLink: p.paymentLink || "",
      });

      setAddDialogOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function handleAdd() {
    if (!addingDiscovery) return;
    startTransition(async () => {
      try {
        const result = await addKennelFromDiscovery(addingDiscovery.id, {
          shortName: addForm.shortName,
          fullName: addForm.fullName,
          regionId: addForm.regionId,
          website: addForm.website || undefined,
          contactEmail: addForm.contactEmail || undefined,
          foundedYear: addForm.foundedYear ? (Number.isNaN(Number.parseInt(addForm.foundedYear, 10)) ? undefined : Number.parseInt(addForm.foundedYear, 10)) : undefined,
          hashCash: addForm.hashCash || undefined,
          scheduleDayOfWeek: addForm.scheduleDayOfWeek || undefined,
          scheduleFrequency: addForm.scheduleFrequency || undefined,
          paymentLink: addForm.paymentLink || undefined,
        });
        if ("error" in result) {
          toast.error(result.error);
        } else {
          toast.success(`Kennel "${addForm.shortName}" created`);
          setAddDialogOpen(false);
          setAddingDiscovery(null);
          router.refresh();
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  }

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "review", label: "Needs Review", count: counts.new },
    { key: "matched", label: "Auto-Matched", count: counts.matched },
    { key: "done", label: "Added/Linked", count: counts.addedLinked },
    { key: "dismissed", label: "Dismissed", count: counts.dismissed },
    { key: "all", label: "All", count: counts.total },
  ];

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Discovered" value={counts.total} />
        <StatCard label="Needs Review" value={counts.new} highlight={counts.new > 0} />
        <StatCard label="Auto-Matched" value={counts.matched} />
        <StatCard label="Added / Linked" value={counts.addedLinked} />
      </div>

      {/* Sync Button */}
      <div className="flex items-center gap-2">
        <Button onClick={handleSync} disabled={isPending} size="sm">
          <RefreshCw className={`mr-2 h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
          {isPending ? "Syncing..." : "Sync Now"}
        </Button>
        <span className="text-sm text-muted-foreground">
          Fetches Hash Rego directory + enriches via API
        </span>
      </div>

      {/* Filter Tabs + Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <Button
              key={tab.key}
              variant={filter === tab.key ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
              {tab.count > 0 && (
                <Badge
                  variant={filter === tab.key ? "secondary" : "outline"}
                  className="ml-1.5"
                >
                  {tab.count}
                </Badge>
              )}
            </Button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, slug, location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left font-medium">Kennel</th>
              <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">Location</th>
              <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Details</th>
              <th className="px-3 py-2 text-left font-medium">Best Match</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  {search ? "No discoveries match your search" : "No discoveries in this category"}
                </td>
              </tr>
            )}
            {filtered.map((d) => (
              <DiscoveryRow
                key={d.id}
                discovery={d}
                isPending={isPending}
                onLink={handleLink}
                onDismiss={handleDismiss}
                onUndismiss={handleUndismiss}
                onConfirm={handleConfirm}
                onAdd={() => openAddDialog(d)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Kennel Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Kennel from Discovery</DialogTitle>
            <DialogDescription>
              Pre-filled with Hash Rego profile data. Edit any field before creating.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="add-shortName">Short Name</Label>
              <Input
                id="add-shortName"
                value={addForm.shortName}
                onChange={(e) => setAddForm((p) => ({ ...p, shortName: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-fullName">Full Name</Label>
              <Input
                id="add-fullName"
                value={addForm.fullName}
                onChange={(e) => setAddForm((p) => ({ ...p, fullName: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Region</Label>
              <RegionCombobox
                value={addForm.regionId}
                regions={regions}
                onSelect={(id) => setAddForm((p) => ({ ...p, regionId: id }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="add-website">Website</Label>
                <Input
                  id="add-website"
                  value={addForm.website}
                  onChange={(e) => setAddForm((p) => ({ ...p, website: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="add-email">Contact Email</Label>
                <Input
                  id="add-email"
                  value={addForm.contactEmail}
                  onChange={(e) => setAddForm((p) => ({ ...p, contactEmail: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="add-founded">Founded</Label>
                <Input
                  id="add-founded"
                  type="number"
                  value={addForm.foundedYear}
                  onChange={(e) => setAddForm((p) => ({ ...p, foundedYear: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="add-hashcash">Hash Cash</Label>
                <Input
                  id="add-hashcash"
                  placeholder="$10"
                  value={addForm.hashCash}
                  onChange={(e) => setAddForm((p) => ({ ...p, hashCash: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="add-payment">Payment Link</Label>
                <Input
                  id="add-payment"
                  value={addForm.paymentLink}
                  onChange={(e) => setAddForm((p) => ({ ...p, paymentLink: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="add-frequency">Frequency</Label>
                <Input
                  id="add-frequency"
                  placeholder="Weekly"
                  value={addForm.scheduleFrequency}
                  onChange={(e) => setAddForm((p) => ({ ...p, scheduleFrequency: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="add-day">Day of Week</Label>
                <Input
                  id="add-day"
                  placeholder="Saturday"
                  value={addForm.scheduleDayOfWeek}
                  onChange={(e) => setAddForm((p) => ({ ...p, scheduleDayOfWeek: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={isPending || !addForm.shortName || !addForm.fullName || !addForm.regionId}>
              {isPending ? "Creating..." : "Create Kennel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, highlight }: Readonly<{ label: string; value: number; highlight?: boolean }>) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${highlight ? "text-orange-600" : ""}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function getScoreColor(pct: number): string {
  if (pct >= 95) return "bg-green-500";
  if (pct >= 80) return "bg-yellow-500";
  return "bg-orange-500";
}

function ScoreBar({ score }: Readonly<{ score: number }>) {
  const pct = Math.min(100, Math.round(score * 100));
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${getScoreColor(pct)}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{pct}%</span>
    </div>
  );
}

function MatchDisplay({ discovery: d }: Readonly<{ discovery: DiscoveryRecord }>) {
  if (d.matchedKennel) {
    return (
      <div className="flex flex-col gap-0.5">
        <Link
          href={`/kennels/${d.matchedKennel.slug}`}
          className="text-sm font-medium hover:underline"
        >
          {d.matchedKennel.shortName}
        </Link>
        {d.matchScore != null && <ScoreBar score={d.matchScore} />}
      </div>
    );
  }

  if (d.matchCandidates && d.matchCandidates.length > 0) {
    return (
      <div className="flex flex-col gap-0.5">
        {d.matchCandidates.slice(0, 2).map((c) => (
          <div key={c.id} className="flex items-center gap-1">
            <span className="text-xs">{c.shortName}</span>
            <ScoreBar score={c.score} />
          </div>
        ))}
      </div>
    );
  }

  return <span className="text-xs text-muted-foreground">No match</span>;
}

function DiscoveryRow({
  discovery: d,
  isPending,
  onLink,
  onDismiss,
  onUndismiss,
  onConfirm,
  onAdd,
}: Readonly<{
  discovery: DiscoveryRecord;
  isPending: boolean;
  onLink: (discoveryId: string, kennelId: string) => void;
  onDismiss: (id: string) => void;
  onUndismiss: (id: string) => void;
  onConfirm: (id: string) => void;
  onAdd: () => void;
}>) {
  const statusBadge = STATUS_BADGES[d.status] || STATUS_BADGES.NEW;

  return (
    <tr className="border-b hover:bg-muted/30">
      {/* Kennel */}
      <td className="px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{d.name}</span>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-xs font-mono">
              {d.externalSlug}
            </Badge>
            {d.externalUrl && (
              <a
                href={d.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Open ${d.externalSlug} on Hash Rego`}
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </td>

      {/* Location */}
      <td className="px-3 py-2 hidden sm:table-cell">
        <span className="text-sm text-muted-foreground">{d.location || "—"}</span>
      </td>

      {/* Details */}
      <td className="px-3 py-2 hidden md:table-cell">
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {d.schedule && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" /> {d.schedule}
            </span>
          )}
          {safeUrl(d.website) && (
            <span className="flex items-center gap-1">
              <Globe className="h-3 w-3" />
              <a href={safeUrl(d.website)!} target="_blank" rel="noopener noreferrer" className="hover:underline truncate max-w-[140px]">
                {d.website!.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            </span>
          )}
          {d.yearStarted && <span>Est. {d.yearStarted}</span>}
        </div>
      </td>

      {/* Best Match */}
      <td className="px-3 py-2">
        <MatchDisplay discovery={d} />
      </td>

      {/* Status */}
      <td className="px-3 py-2">
        <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
      </td>

      {/* Actions */}
      <td className="px-3 py-2 text-right">
        <DiscoveryActions
          discovery={d}
          isPending={isPending}
          onLink={onLink}
          onDismiss={onDismiss}
          onUndismiss={onUndismiss}
          onConfirm={onConfirm}
          onAdd={onAdd}
        />
      </td>
    </tr>
  );
}

function DiscoveryActions({
  discovery: d,
  isPending,
  onLink,
  onDismiss,
  onUndismiss,
  onConfirm,
  onAdd,
}: Readonly<{
  discovery: DiscoveryRecord;
  isPending: boolean;
  onLink: (discoveryId: string, kennelId: string) => void;
  onDismiss: (id: string) => void;
  onUndismiss: (id: string) => void;
  onConfirm: (id: string) => void;
  onAdd: () => void;
}>) {
  if (d.status === "ADDED" || d.status === "LINKED") {
    return d.matchedKennel ? (
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/kennels/${d.matchedKennel.slug}`}>View</Link>
      </Button>
    ) : null;
  }

  if (d.status === "DISMISSED") {
    return (
      <Button variant="ghost" size="sm" onClick={() => onUndismiss(d.id)} disabled={isPending}>
        <Undo2 className="mr-1 h-3 w-3" /> Undo
      </Button>
    );
  }

  if (d.status === "MATCHED") {
    return (
      <div className="flex items-center gap-1 justify-end">
        <Button variant="outline" size="sm" onClick={() => onConfirm(d.id)} disabled={isPending}>
          <Check className="mr-1 h-3 w-3" /> Confirm
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDismiss(d.id)} disabled={isPending}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  // NEW status
  const candidates = d.matchCandidates || [];

  return (
    <div className="flex items-center gap-1 justify-end">
      {candidates.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={isPending}>
              <LinkIcon className="mr-1 h-3 w-3" /> Link
              <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {candidates.map((c) => (
              <DropdownMenuItem key={c.id} onClick={() => onLink(d.id, c.id)}>
                {c.shortName} ({Math.min(100, Math.round(c.score * 100))}%)
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <Button variant="outline" size="sm" onClick={onAdd} disabled={isPending}>
        <Plus className="mr-1 h-3 w-3" /> Add
      </Button>
      <Button variant="ghost" size="sm" onClick={() => onDismiss(d.id)} disabled={isPending}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
