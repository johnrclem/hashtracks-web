"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { disconnectStrava, triggerStravaSync } from "@/app/strava/actions";

interface StravaConnectionCardProps {
  connection: {
    connected: boolean;
    athleteName?: string;
    lastSyncAt?: string;
    activityCount?: number;
  };
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function StravaConnectionCard({
  connection,
}: StravaConnectionCardProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSync() {
    setIsSyncing(true);
    startTransition(async () => {
      const result = await triggerStravaSync();
      setIsSyncing(false);
      if (!result.success) {
        toast.error(result.error);
      } else {
        toast.success(`Synced ${result.syncedCount} activities`);
      }
      router.refresh();
    });
  }

  function handleDisconnect() {
    startTransition(async () => {
      const result = await disconnectStrava();
      if (!result.success) {
        toast.error(result.error);
      } else {
        toast.success("Strava disconnected");
      }
      router.refresh();
    });
  }

  if (!connection.connected) {
    return (
      <div className="rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">
          Link your Strava account to easily attach activities to your hash
          runs.
        </p>
        <a href="/api/auth/strava">
          <Button className="mt-3 bg-[#FC4C02] hover:bg-[#E34402] text-white">
            Connect with Strava
          </Button>
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Strava Connected</p>
          <p className="text-xs text-muted-foreground">
            {connection.athleteName && (
              <span>Connected as {connection.athleteName}</span>
            )}
            {connection.lastSyncAt && (
              <span>
                {connection.athleteName ? " · " : ""}
                Last synced: {formatRelativeTime(connection.lastSyncAt)}
              </span>
            )}
            {connection.activityCount !== undefined && (
              <span>
                {" "}
                · {connection.activityCount}{" "}
                {connection.activityCount === 1 ? "activity" : "activities"}{" "}
                cached
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={isSyncing || isPending}
        >
          {isSyncing ? "Syncing..." : "Sync Now"}
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={isPending}
            >
              Disconnect
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect Strava?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove your Strava connection and delete all cached
                activity data. Strava activity links that were automatically
                attached to your logbook entries will be cleared. Manually pasted
                URLs will be preserved.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDisconnect}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
