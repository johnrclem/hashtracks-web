"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import {
  acceptLinkRequest,
  declineLinkRequest,
  revokeMyLink,
} from "@/app/profile/actions";

export interface KennelLinkData {
  id: string;
  status: string;
  hashName: string | null;
  nerdName: string | null;
  kennelShortName: string;
  kennelSlug: string | null;
  groupKennels: { shortName: string; slug: string }[];
  createdAt: string;
}

interface KennelConnectionsProps {
  links: KennelLinkData[];
}

export function KennelConnections({ links }: KennelConnectionsProps) {
  const pending = links.filter((l) => l.status === "SUGGESTED");
  const confirmed = links.filter((l) => l.status === "CONFIRMED");

  if (links.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No kennel connections yet. When a kennel&apos;s manager links your
        profile to their roster, you&apos;ll see it here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            When linked, attendance recorded by the kennel&apos;s manager will
            automatically appear in your logbook.
          </p>
          {pending.map((link) => (
            <PendingLinkRow key={link.id} link={link} />
          ))}
        </div>
      )}
      {confirmed.length > 0 && (
        <div className="space-y-2">
          {confirmed.map((link) => (
            <ConfirmedLinkRow key={link.id} link={link} />
          ))}
        </div>
      )}
    </div>
  );
}

function PendingLinkRow({ link }: { link: KennelLinkData }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleAccept() {
    startTransition(async () => {
      const result = await acceptLinkRequest(link.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Linked to ${link.kennelShortName}`);
        router.refresh();
      }
    });
  }

  function handleDecline() {
    startTransition(async () => {
      const result = await declineLinkRequest(link.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Link request declined");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50/50 px-4 py-3 dark:border-blue-900 dark:bg-blue-950/30">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300">
            Pending
          </Badge>
          <KennelName shortName={link.kennelShortName} slug={link.kennelSlug} />
        </div>
        <span className="text-sm text-muted-foreground">
          wants to link your profile
          {link.hashName && (
            <>
              {" "}as <strong>{link.hashName}</strong>
            </>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          onClick={handleAccept}
          disabled={isPending}
        >
          {isPending ? "..." : "Accept"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDecline}
          disabled={isPending}
        >
          Decline
        </Button>
      </div>
    </div>
  );
}

function ConfirmedLinkRow({ link }: { link: KennelLinkData }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleRevoke() {
    startTransition(async () => {
      const result = await revokeMyLink(link.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Unlinked from ${link.kennelShortName}`);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-4 py-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Linked</Badge>
          <KennelName shortName={link.kennelShortName} slug={link.kennelSlug} />
        </div>
        {link.hashName && (
          <span className="text-sm text-muted-foreground">
            as <strong>{link.hashName}</strong>
          </span>
        )}
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive shrink-0"
            disabled={isPending}
          >
            Revoke
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke kennel connection?</AlertDialogTitle>
            <AlertDialogDescription>
              This will unlink your profile from {link.kennelShortName}&apos;s
              roster. Your existing logbook entries will be preserved, but future
              attendance recorded by the kennel&apos;s manager won&apos;t
              automatically appear in your logbook.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? "Revoking..." : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KennelName({ shortName, slug }: { shortName: string; slug: string | null }) {
  if (slug) {
    return (
      <Link href={`/kennels/${slug}`} className="font-medium hover:underline">
        {shortName}
      </Link>
    );
  }
  return <span className="font-medium">{shortName}</span>;
}
