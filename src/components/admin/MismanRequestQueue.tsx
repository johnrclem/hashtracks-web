"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";
import {
  approveMismanRequest,
  rejectMismanRequest,
  revokeMismanAccess,
} from "@/app/misman/actions";
import { createMismanInvite, revokeMismanInvite } from "@/app/misman/invite/actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import type { KennelOptionData } from "@/components/kennels/KennelOptionLabel";
import { KennelOptionLabel } from "@/components/kennels/KennelOptionLabel";

// ── Types ──

type MismanRequestRow = {
  id: string;
  user: {
    id: string;
    email: string;
    hashName: string | null;
    nerdName: string | null;
  };
  kennel: { shortName: string; fullName: string; slug: string };
  message: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
};

type InviteRow = {
  id: string;
  kennelShortName: string;
  kennelFullName: string;
  kennelSlug: string;
  inviteeEmail: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  inviterName: string;
  acceptorName: string | null;
};

type ActiveMismanRow = {
  id: string;
  user: {
    id: string;
    email: string;
    hashName: string | null;
    nerdName: string | null;
  };
  kennel: { id: string; shortName: string; fullName: string; slug: string };
  role: string;
  since: string;
  grantSource: "request" | "invite" | "manual";
};

interface MismanAdminTabsProps {
  requests: MismanRequestRow[];
  invites: InviteRow[];
  mismans: ActiveMismanRow[];
  kennels: KennelOptionData[];
}

// ── Main Component ──

export function MismanAdminTabs({
  requests,
  invites,
  mismans,
  kennels,
}: MismanAdminTabsProps) {
  const pendingRequests = requests.filter((r) => r.status === "PENDING");
  const [requestKennelFilter, setRequestKennelFilter] = useState("all");
  const [inviteKennelFilter, setInviteKennelFilter] = useState("all");
  const [mismanKennelFilter, setMismanKennelFilter] = useState("all");

  const requestKennels = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of pendingRequests) {
      if (!map.has(r.kennel.slug)) map.set(r.kennel.slug, r.kennel.shortName);
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [pendingRequests]);
  const inviteKennels = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of invites) {
      if (!map.has(i.kennelSlug)) map.set(i.kennelSlug, i.kennelShortName);
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [invites]);
  const mismanKennels = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of mismans) {
      if (!map.has(m.kennel.slug)) map.set(m.kennel.slug, m.kennel.shortName);
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [mismans]);

  const filteredRequests =
    requestKennelFilter === "all"
      ? pendingRequests
      : pendingRequests.filter((r) => r.kennel.slug === requestKennelFilter);
  const filteredInvites =
    inviteKennelFilter === "all"
      ? invites
      : invites.filter((i) => i.kennelSlug === inviteKennelFilter);
  const filteredMismans =
    mismanKennelFilter === "all"
      ? mismans
      : mismans.filter((m) => m.kennel.slug === mismanKennelFilter);

  return (
    <TooltipProvider>
      <Tabs defaultValue="requests">
        <div className="flex items-center justify-between gap-4">
          <TabsList>
            <TabsTrigger value="requests">
              Pending Requests ({pendingRequests.length})
            </TabsTrigger>
            <TabsTrigger value="invites">
              Invites Sent ({invites.length})
            </TabsTrigger>
            <TabsTrigger value="mismans">
              Active Mismanagement ({mismans.length})
            </TabsTrigger>
          </TabsList>
          <InviteMismanDialog kennels={kennels} />
        </div>

        <TabsContent value="requests" className="mt-4">
          <KennelFilterBar
            kennels={requestKennels}
            value={requestKennelFilter}
            onChange={setRequestKennelFilter}
          />
          <PendingRequestsTab requests={filteredRequests} />
        </TabsContent>
        <TabsContent value="invites" className="mt-4">
          <KennelFilterBar
            kennels={inviteKennels}
            value={inviteKennelFilter}
            onChange={setInviteKennelFilter}
          />
          <InviteHistoryTab invites={filteredInvites} />
        </TabsContent>
        <TabsContent value="mismans" className="mt-4">
          <KennelFilterBar
            kennels={mismanKennels}
            value={mismanKennelFilter}
            onChange={setMismanKennelFilter}
          />
          <ActiveMismansTab mismans={filteredMismans} />
        </TabsContent>
      </Tabs>
    </TooltipProvider>
  );
}

// Keep old export name for backwards compat with any other importers
export { MismanAdminTabs as MismanRequestQueue };

// ── Shared Kennel Link ──

function KennelLinkWithTooltip({
  shortName,
  fullName,
  slug,
}: {
  shortName: string;
  fullName: string;
  slug: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={`/kennels/${slug}`}
          className="text-primary hover:underline"
        >
          {shortName}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{fullName}</TooltipContent>
    </Tooltip>
  );
}

// ── Kennel Filter ──

function KennelFilterBar({
  kennels,
  value,
  onChange,
}: {
  kennels: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (kennels.length <= 1) return null;

  return (
    <div className="mb-3">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="All kennels" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All kennels</SelectItem>
          {kennels.map((k) => (
            <SelectItem key={k.value} value={k.value}>
              {k.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Tab 1: Pending Requests ──

function PendingRequestsTab({ requests }: { requests: MismanRequestRow[] }) {
  if (requests.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No pending misman requests.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Kennel</TableHead>
          <TableHead className="hidden sm:table-cell">Message</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">Date</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map((request) => (
          <MismanRequestRowComponent key={request.id} request={request} />
        ))}
      </TableBody>
    </Table>
  );
}

function MismanRequestRowComponent({
  request,
}: {
  request: MismanRequestRow;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const displayName =
    request.user.hashName || request.user.nerdName || request.user.email;

  function handleApprove() {
    startTransition(async () => {
      const result = await approveMismanRequest(request.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(
          `Approved ${displayName} as misman for ${request.kennel.shortName}`,
        );
      }
      router.refresh();
    });
  }

  function handleReject() {
    startTransition(async () => {
      const result = await rejectMismanRequest(request.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Request rejected");
      }
      router.refresh();
    });
  }

  return (
    <TableRow>
      <TableCell>
        <div>
          <span className="font-medium">{displayName}</span>
          {request.user.hashName && (
            <span className="block text-xs text-muted-foreground">
              {request.user.email}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="font-medium">
        <KennelLinkWithTooltip
          shortName={request.kennel.shortName}
          fullName={request.kennel.fullName}
          slug={request.kennel.slug}
        />
      </TableCell>
      <TableCell className="hidden sm:table-cell max-w-48 truncate">
        {request.message ?? "\u2014"}
      </TableCell>
      <TableCell>
        <Badge variant="secondary">{request.status}</Badge>
      </TableCell>
      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
        {new Date(request.createdAt).toLocaleDateString()}
      </TableCell>
      <TableCell className="text-right">
        {request.status === "PENDING" && (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              disabled={isPending}
              onClick={handleApprove}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={handleReject}
            >
              Reject
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

// ── Tab 2: Invite History ──

function InviteHistoryTab({ invites }: { invites: InviteRow[] }) {
  if (invites.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No misman invites yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Kennel</TableHead>
          <TableHead>Inviter</TableHead>
          <TableHead className="hidden sm:table-cell">Email</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">Detail</TableHead>
          <TableHead className="hidden sm:table-cell">Created</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invites.map((invite) => (
          <InviteRowComponent key={invite.id} invite={invite} />
        ))}
      </TableBody>
    </Table>
  );
}

function InviteRowComponent({ invite }: { invite: InviteRow }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const statusVariant =
    invite.status === "ACCEPTED"
      ? "default"
      : invite.status === "REVOKED"
        ? "destructive"
        : invite.status === "EXPIRED"
          ? "outline"
          : "secondary";

  function statusDetail() {
    if (invite.status === "ACCEPTED" && invite.acceptorName) {
      return `Accepted by ${invite.acceptorName}`;
    }
    if (invite.status === "REVOKED" && invite.revokedAt) {
      return `Revoked ${new Date(invite.revokedAt).toLocaleDateString()}`;
    }
    if (invite.status === "EXPIRED") {
      return `Expired ${new Date(invite.expiresAt).toLocaleDateString()}`;
    }
    if (invite.status === "PENDING") {
      return `Expires ${new Date(invite.expiresAt).toLocaleDateString()}`;
    }
    return null;
  }

  function handleRevoke() {
    startTransition(async () => {
      const result = await revokeMismanInvite(invite.id);
      if ("error" in result && result.error) {
        toast.error(result.error);
      } else {
        toast.success("Invite revoked");
      }
      router.refresh();
    });
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        <KennelLinkWithTooltip
          shortName={invite.kennelShortName}
          fullName={invite.kennelFullName}
          slug={invite.kennelSlug}
        />
      </TableCell>
      <TableCell>{invite.inviterName}</TableCell>
      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
        {invite.inviteeEmail ?? "\u2014"}
      </TableCell>
      <TableCell>
        <Badge variant={statusVariant}>{invite.status}</Badge>
      </TableCell>
      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
        {statusDetail()}
      </TableCell>
      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
        {new Date(invite.createdAt).toLocaleDateString()}
      </TableCell>
      <TableCell className="text-right">
        {invite.status === "PENDING" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={isPending}>
                Revoke
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke Invite</AlertDialogTitle>
                <AlertDialogDescription>
                  This will revoke the pending invite for{" "}
                  <strong>{invite.kennelShortName}</strong>. The invite link
                  will no longer be usable.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleRevoke}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Revoke Invite
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </TableCell>
    </TableRow>
  );
}

// ── Tab 3: Active Mismans ──

function ActiveMismansTab({ mismans }: { mismans: ActiveMismanRow[] }) {
  if (mismans.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active mismans.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Kennel</TableHead>
          <TableHead className="hidden sm:table-cell">Source</TableHead>
          <TableHead className="hidden sm:table-cell">Since</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {mismans.map((misman) => (
          <ActiveMismanRowComponent key={misman.id} misman={misman} />
        ))}
      </TableBody>
    </Table>
  );
}

function ActiveMismanRowComponent({
  misman,
}: {
  misman: ActiveMismanRow;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const displayName =
    misman.user.hashName || misman.user.nerdName || misman.user.email;

  const sourceLabel =
    misman.grantSource === "request"
      ? "Request"
      : misman.grantSource === "invite"
        ? "Invite"
        : "Manual";

  const sourceBadgeVariant: "default" | "secondary" | "outline" =
    misman.grantSource === "request"
      ? "default"
      : misman.grantSource === "invite"
        ? "secondary"
        : "outline";

  function handleRevoke() {
    startTransition(async () => {
      const result = await revokeMismanAccess(misman.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(
          `Revoked misman access for ${displayName} on ${misman.kennel.shortName}`,
        );
      }
      router.refresh();
    });
  }

  return (
    <TableRow>
      <TableCell>
        <div>
          <span className="font-medium">{displayName}</span>
          {misman.user.hashName && (
            <span className="block text-xs text-muted-foreground">
              {misman.user.email}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="font-medium">
        <KennelLinkWithTooltip
          shortName={misman.kennel.shortName}
          fullName={misman.kennel.fullName}
          slug={misman.kennel.slug}
        />
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Badge variant={sourceBadgeVariant}>
          {sourceLabel}
        </Badge>
      </TableCell>
      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
        {new Date(misman.since).toLocaleDateString()}
      </TableCell>
      <TableCell className="text-right">
        {misman.role === "MISMAN" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" disabled={isPending}>
                Revoke
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke Misman Access</AlertDialogTitle>
                <AlertDialogDescription>
                  This will downgrade <strong>{displayName}</strong> from misman
                  to member for <strong>{misman.kennel.shortName}</strong>. They
                  will lose access to roster and attendance management for this
                  kennel.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleRevoke}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Revoke Access
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </TableCell>
    </TableRow>
  );
}

// ── Invite Misman Dialog ──

type InviteResult = {
  kennelId: string;
  kennelName: string;
  inviteUrl: string;
};

function InviteMismanDialog({ kennels }: { kennels: KennelOptionData[] }) {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [email, setEmail] = useState("");
  const [results, setResults] = useState<InviteResult[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const kennelMap = new Map(kennels.map((k) => [k.id, k]));
  const hasResults = results.length > 0;

  function reset() {
    setSelectedIds(new Set());
    setEmail("");
    setResults([]);
    setErrors([]);
    setCopiedId(null);
  }

  function toggleKennel(kennelId: string) {
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

  function handleGenerate() {
    if (selectedIds.size === 0) {
      toast.error("Select at least one kennel");
      return;
    }

    startTransition(async () => {
      const inviteResults: InviteResult[] = [];
      const inviteErrors: string[] = [];

      for (const kennelId of selectedIds) {
        const kennel = kennelMap.get(kennelId);
        const result = await createMismanInvite(
          kennelId,
          email.trim() || undefined,
        );
        if (result.error) {
          inviteErrors.push(`${kennel?.shortName ?? kennelId}: ${result.error}`);
        } else if (result.data) {
          inviteResults.push({
            kennelId,
            kennelName: kennel?.shortName ?? kennelId,
            inviteUrl: result.data.inviteUrl,
          });
        }
      }

      setResults(inviteResults);
      setErrors(inviteErrors);

      if (inviteResults.length > 0) {
        toast.success(
          `Generated ${inviteResults.length} invite link${inviteResults.length > 1 ? "s" : ""}`,
        );
      }
      if (inviteErrors.length > 0) {
        toast.error(`${inviteErrors.length} failed`);
      }
    });
  }

  async function handleCopy(inviteUrl: string, kennelId: string) {
    await navigator.clipboard.writeText(inviteUrl);
    setCopiedId(kennelId);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleCopyAll() {
    const text = results
      .map((r) => `${r.kennelName}: ${r.inviteUrl}`)
      .join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedId("__all__");
    toast.success("All links copied");
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Invite Misman</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite Misman</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {/* Kennel picker */}
          <div className="space-y-2">
            <Label>Kennels</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between font-normal"
                  disabled={hasResults}
                >
                  {selectedIds.size === 0
                    ? "Search and select kennels..."
                    : `${selectedIds.size} kennel${selectedIds.size > 1 ? "s" : ""} selected`}
                  <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search kennels..." />
                  <CommandList>
                    <CommandEmpty>No kennels found.</CommandEmpty>
                    <CommandGroup>
                      {kennels.map((k) => {
                        const isSelected = selectedIds.has(k.id);
                        return (
                          <CommandItem
                            key={k.id}
                            value={`${k.shortName} ${k.fullName} ${k.region}`}
                            onSelect={() => toggleKennel(k.id)}
                          >
                            <div className="flex size-4 shrink-0 items-center justify-center rounded-sm border border-primary">
                              {isSelected && <CheckIcon className="size-3" />}
                            </div>
                            <KennelOptionLabel kennel={k} />
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Selected kennel badges */}
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {[...selectedIds].map((id) => {
                  const k = kennelMap.get(id);
                  if (!k) return null;
                  return (
                    <Badge key={id} variant="secondary" className="gap-1 pr-1">
                      {k.shortName}
                      {!hasResults && (
                        <button
                          type="button"
                          className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                          onClick={() => toggleKennel(id)}
                        >
                          <XIcon className="size-3" />
                        </button>
                      )}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email (optional)</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="hasher@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={hasResults}
            />
          </div>

          {/* Generate or results */}
          {!hasResults ? (
            <Button
              onClick={handleGenerate}
              disabled={isPending || selectedIds.size === 0}
              className="w-full"
            >
              {isPending
                ? "Generating..."
                : `Generate Invite Link${selectedIds.size > 1 ? "s" : ""}`}
            </Button>
          ) : (
            <div className="space-y-3">
              {/* Error list */}
              {errors.length > 0 && (
                <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                  {errors.map((e, i) => (
                    <div key={i}>{e}</div>
                  ))}
                </div>
              )}

              {/* Invite links */}
              <div className="space-y-2">
                {results.map((r) => (
                  <div key={r.kennelId} className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">
                      {r.kennelName}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={r.inviteUrl}
                        readOnly
                        className="font-mono text-xs"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopy(r.inviteUrl, r.kennelId)}
                      >
                        {copiedId === r.kennelId ? "Copied!" : "Copy"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2">
                {results.length > 1 && (
                  <Button variant="outline" size="sm" onClick={handleCopyAll}>
                    {copiedId === "__all__" ? "Copied!" : "Copy All"}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={reset}>
                  Create Another
                </Button>
                <Button size="sm" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
