"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveMismanRequest,
  rejectMismanRequest,
} from "@/app/misman/actions";
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

interface MismanRequestQueueProps {
  requests: MismanRequestRow[];
}

export function MismanRequestQueue({ requests }: MismanRequestQueueProps) {
  if (requests.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No misman requests yet.
      </p>
    );
  }

  return (
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
