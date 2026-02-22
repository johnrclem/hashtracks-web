"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveRequest, rejectRequest } from "@/app/admin/requests/actions";
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

type KennelRequest = {
  id: string;
  kennelName: string;
  region: string | null;
  country: string | null;
  sourceUrl: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
};

interface RequestQueueProps {
  requests: KennelRequest[];
}

export function RequestQueue({ requests }: RequestQueueProps) {
  if (requests.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No kennel requests yet.</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Kennel Name</TableHead>
          <TableHead>Region</TableHead>
          <TableHead className="hidden sm:table-cell">Source URL</TableHead>
          <TableHead className="hidden sm:table-cell">Notes</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">Date</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map((request) => (
          <RequestRow key={request.id} request={request} />
        ))}
      </TableBody>
    </Table>
  );
}

function RequestRow({ request }: { request: KennelRequest }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleAction(action: typeof approveRequest) {
    startTransition(async () => {
      const result = await action(request.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(
          action === approveRequest ? "Request approved" : "Request rejected",
        );
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
      <TableCell className="font-medium">{request.kennelName}</TableCell>
      <TableCell>{request.region ?? "—"}</TableCell>
      <TableCell className="hidden sm:table-cell">
        {request.sourceUrl ? (
          <a
            href={request.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Link
          </a>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="hidden sm:table-cell max-w-48 truncate">
        {request.notes ?? "—"}
      </TableCell>
      <TableCell>
        <Badge variant={statusVariant}>{request.status}</Badge>
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
              onClick={() => handleAction(approveRequest)}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => handleAction(rejectRequest)}
            >
              Reject
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
