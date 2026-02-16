"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";
import {
  approveMismanRequest,
  rejectMismanRequest,
} from "@/app/misman/actions";
import { createMismanInvite } from "@/app/misman/invite/actions";
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
import { toast } from "sonner";

type MismanRequestRow = {
  id: string;
  user: {
    id: string;
    email: string;
    hashName: string | null;
    nerdName: string | null;
  };
  kennel: { shortName: string; slug: string };
  message: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
};

type KennelOption = {
  id: string;
  shortName: string;
  fullName: string;
  region: string;
};

interface MismanRequestQueueProps {
  requests: MismanRequestRow[];
  kennels: KennelOption[];
}

export function MismanRequestQueue({ requests, kennels }: MismanRequestQueueProps) {
  return (
    <div>
      <div className="mb-4 flex justify-end">
        <InviteMismanDialog kennels={kennels} />
      </div>
      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No misman requests yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Kennel</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((request) => (
              <MismanRequestRowComponent key={request.id} request={request} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

type InviteResult = {
  kennelId: string;
  kennelName: string;
  inviteUrl: string;
};

function InviteMismanDialog({ kennels }: { kennels: KennelOption[] }) {
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
                            <div className="ml-1 flex-1 truncate">
                              <span className="font-medium">{k.shortName}</span>
                              <span className="ml-1.5 text-muted-foreground">
                                {k.fullName}
                              </span>
                            </div>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {k.region}
                            </span>
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

  const statusVariant =
    request.status === "APPROVED"
      ? "default"
      : request.status === "REJECTED"
        ? "destructive"
        : "secondary";

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
        {request.kennel.shortName}
      </TableCell>
      <TableCell className="max-w-48 truncate">
        {request.message ?? "—"}
      </TableCell>
      <TableCell>
        <Badge variant={statusVariant}>{request.status}</Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
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
