"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  approveMismanRequest,
  rejectMismanRequest,
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
  kennel: { shortName: string; slug: string };
  message: string | null;
  createdAt: string;
}

interface MismanDashboardProps {
  kennels: MismanKennel[];
  pendingRequests: PendingRequest[];
  myPendingRequests: MyPendingRequest[];
  isSiteAdmin: boolean;
}

export function MismanDashboard({
  kennels,
  pendingRequests,
  myPendingRequests,
  isSiteAdmin,
}: MismanDashboardProps) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Misman Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage attendance and rosters for your kennels.
        </p>
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
