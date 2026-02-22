"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  KennelOptionLabel,
  type KennelOptionData,
} from "@/components/kennels/KennelOptionLabel";
import {
  approveMismanRequest,
  rejectMismanRequest,
  requestMismanAccessFromDashboard,
  requestRosterGroupByName,
} from "@/app/misman/actions";

interface MismanKennel {
  id: string;
  shortName: string;
  fullName: string;
  slug: string;
  region: string;
  role: string;
}

interface PendingRequest {
  id: string;
  user: { id: string; email: string; hashName: string | null; nerdName: string | null };
  kennel: { shortName: string; slug: string };
  message: string | null;
  createdAt: string;
}

interface MyPendingRequest {
  id: string;
  kennelId: string;
  kennel: { shortName: string; slug: string };
  message: string | null;
  createdAt: string;
}

interface MyPendingRosterGroupRequest {
  id: string;
  proposedName: string;
  kennelNames: string[];
  message: string | null;
  createdAt: string;
}

interface MismanDashboardProps {
  kennels: MismanKennel[];
  pendingRequests: PendingRequest[];
  myPendingRequests: MyPendingRequest[];
  myPendingRosterGroupRequests: MyPendingRosterGroupRequest[];
  isSiteAdmin: boolean;
  allKennels: KennelOptionData[];
}

export function MismanDashboard({
  kennels,
  pendingRequests,
  myPendingRequests,
  myPendingRosterGroupRequests,
  isSiteAdmin,
  allKennels,
}: MismanDashboardProps) {
  const [showRosterGroupDialog, setShowRosterGroupDialog] = useState(false);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Misman Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Record attendance, manage your roster, and track run history.
          </p>
        </div>
        {kennels.length >= 1 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRosterGroupDialog(true)}
              >
                Request Shared Roster
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Share one roster across sister kennels with overlapping hashers
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Pending requests to approve */}
      {pendingRequests.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Pending Requests</h2>
          <div className="space-y-2">
            {pendingRequests.map((req) => (
              <RequestCard key={req.id} request={req} />
            ))}
          </div>
        </div>
      )}

      {/* User's own pending requests */}
      {myPendingRequests.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Your Pending Requests</h2>
          <div className="space-y-2">
            {myPendingRequests.map((req) => (
              <div
                key={req.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <span className="font-medium">{req.kennel.shortName}</span>
                  {req.message && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {req.message}
                    </p>
                  )}
                </div>
                <Badge variant="outline">Pending</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending roster group requests */}
      {myPendingRosterGroupRequests.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Pending Roster Group Requests</h2>
          <div className="space-y-2">
            {myPendingRosterGroupRequests.map((req) => (
              <div
                key={req.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <span className="font-medium">{req.proposedName}</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {req.kennelNames.map((name, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {name}
                      </Badge>
                    ))}
                  </div>
                  {req.message && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {req.message}
                    </p>
                  )}
                </div>
                <Badge variant="outline">Pending</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kennel cards */}
      {kennels.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Your Kennels</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {kennels.map((kennel) => (
              <KennelCard key={kennel.id} kennel={kennel} />
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border p-8 text-center">
          <p className="text-muted-foreground">
            You don&apos;t have misman access to any kennels yet.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Visit a{" "}
            <Link href="/kennels" className="text-primary hover:underline">
              kennel&apos;s page
            </Link>{" "}
            to request misman access.
          </p>
        </div>
      )}

      {/* Request access to another kennel (only for existing mismans) */}
      {kennels.length > 0 && (
        <RequestAnotherKennelSection
          allKennels={allKennels}
          managedKennelIds={kennels.map((k) => k.id)}
          pendingRequestKennelIds={myPendingRequests.map((r) => r.kennelId)}
        />
      )}

      {/* Request Shared Roster dialog */}
      <RequestRosterGroupDialog
        open={showRosterGroupDialog}
        onClose={() => setShowRosterGroupDialog(false)}
        kennels={kennels}
      />
    </div>
  );
}

function RequestAnotherKennelSection({
  allKennels,
  managedKennelIds,
  pendingRequestKennelIds,
}: {
  allKennels: KennelOptionData[];
  managedKennelIds: string[];
  pendingRequestKennelIds: string[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedKennel, setSelectedKennel] = useState<KennelOptionData | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const excludedIds = new Set([
    ...managedKennelIds,
    ...pendingRequestKennelIds,
  ]);
  const eligibleKennels = allKennels.filter((k) => !excludedIds.has(k.id));

  if (eligibleKennels.length === 0) return null;

  function handleSubmit() {
    if (!selectedKennel) return;
    startTransition(async () => {
      const result = await requestMismanAccessFromDashboard(
        selectedKennel.id,
        message || undefined,
      );
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(
          `Misman access requested for ${selectedKennel.shortName}`,
        );
        setSelectedKennel(null);
        setMessage("");
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-lg border border-dashed p-6 space-y-4">
      <div>
        <h3 className="font-semibold">Missing a kennel?</h3>
        <p className="text-sm text-muted-foreground">
          If you&apos;re the misman for another kennel, request access here.
        </p>
      </div>

      <div className="space-y-3">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-full max-w-sm justify-between font-normal"
            >
              {selectedKennel
                ? selectedKennel.shortName
                : "Search and select a kennel..."}
              <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[var(--radix-popover-trigger-width)] p-0"
            align="start"
          >
            <Command>
              <CommandInput placeholder="Search kennels..." />
              <CommandList>
                <CommandEmpty>No kennels found.</CommandEmpty>
                <CommandGroup>
                  {eligibleKennels.map((k) => (
                    <CommandItem
                      key={k.id}
                      value={`${k.shortName} ${k.fullName} ${k.region}`}
                      onSelect={() => {
                        setSelectedKennel(k);
                        setPickerOpen(false);
                      }}
                    >
                      <KennelOptionLabel kennel={k} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {selectedKennel && (
          <>
            <div className="space-y-2">
              <Label htmlFor="dashboard-misman-message">
                Message (optional)
              </Label>
              <Textarea
                id="dashboard-misman-message"
                placeholder="I'm the misman for this kennel..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
              />
            </div>
            <Button onClick={handleSubmit} disabled={isPending} size="sm">
              {isPending ? "Requesting..." : "Request Access"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function KennelCard({ kennel }: { kennel: MismanKennel }) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{kennel.shortName}</h3>
          <Badge variant="secondary" className="text-xs">
            {kennel.role}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{kennel.fullName}</p>
        <p className="text-xs text-muted-foreground">{kennel.region}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" asChild>
          <Link href={`/misman/${kennel.slug}/attendance`}>Attendance</Link>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link href={`/misman/${kennel.slug}/roster`}>Roster</Link>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link href={`/misman/${kennel.slug}/history`}>History</Link>
        </Button>
      </div>
    </div>
  );
}

function RequestRosterGroupDialog({
  open,
  onClose,
  kennels,
}: {
  open: boolean;
  onClose: () => void;
  kennels: MismanKennel[];
}) {
  const defaultKennelNames = kennels.map((k) => k.shortName).join(", ");
  const [name, setName] = useState("");
  const [kennelNames, setKennelNames] = useState(defaultKennelNames);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    // Use the first kennel ID for auth context
    const firstKennelId = kennels[0]?.id;
    if (!firstKennelId) return;

    startTransition(async () => {
      const result = await requestRosterGroupByName(
        firstKennelId,
        name,
        kennelNames,
        message || undefined,
      );
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Roster group request submitted");
        setName("");
        setKennelNames(defaultKennelNames);
        setMessage("");
        onClose();
        router.refresh();
      }
    });
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setName("");
      setKennelNames(defaultKennelNames);
      setMessage("");
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Shared Roster</DialogTitle>
          <DialogDescription>
            Propose grouping kennels to share a roster. An admin will review
            your request and set up the group.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="roster-group-name">Group Name</Label>
            <Input
              id="roster-group-name"
              placeholder="e.g., NYC Metro"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="roster-group-kennels">Kennels to include</Label>
            <Input
              id="roster-group-kennels"
              placeholder="e.g., NYCH3, NYCH4, LBH3"
              value={kennelNames}
              onChange={(e) => setKennelNames(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated kennel short names. You don&apos;t need to manage
              all of them — the admin will coordinate.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="roster-group-message">Additional details (optional)</Label>
            <Textarea
              id="roster-group-message"
              placeholder="Why should these kennels share a roster?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !name.trim() || !kennelNames.trim()}
          >
            {isPending ? "Submitting..." : "Submit Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestCard({ request }: { request: PendingRequest }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleApprove() {
    startTransition(async () => {
      const result = await approveMismanRequest(request.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(
          `Approved ${request.user.hashName || request.user.email} as misman for ${request.kennel.shortName}`,
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

  const displayName =
    request.user.hashName || request.user.nerdName || request.user.email;

  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div>
        <p className="font-medium">
          {displayName}
          <span className="ml-2 text-sm text-muted-foreground">
            wants misman access to {request.kennel.shortName}
          </span>
        </p>
        {request.message && (
          <p className="mt-0.5 text-sm text-muted-foreground italic">
            &ldquo;{request.message}&rdquo;
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={handleApprove}
          disabled={isPending}
        >
          {isPending ? "..." : "Approve"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleReject}
          disabled={isPending}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
