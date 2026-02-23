"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getMyKennelLinks,
  acceptLinkRequest,
  declineLinkRequest,
} from "@/app/profile/actions";

interface PendingLink {
  id: string;
  kennelShortName: string;
  hashName: string | null;
}

export function PendingLinkRequests() {
  const [links, setLinks] = useState<PendingLink[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    getMyKennelLinks().then((result) => {
      if (result.data) {
        setLinks(
          result.data
            .filter((l) => l.status === "SUGGESTED")
            .map((l) => ({
              id: l.id,
              kennelShortName: l.kennelShortName,
              hashName: l.hashName,
            })),
        );
      }
      setLoaded(true);
    });

    try {
      const stored = localStorage.getItem("dismissed-link-requests");
      if (stored) setDismissed(new Set(JSON.parse(stored)));
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  function removeLinkFromState(id: string) {
    setLinks((prev) => prev.filter((l) => l.id !== id));
  }

  function handleAccept(linkId: string) {
    startTransition(async () => {
      const result = await acceptLinkRequest(linkId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Profile linked");
        removeLinkFromState(linkId);
        router.refresh();
      }
    });
  }

  function handleDismiss(linkId: string) {
    const next = new Set(dismissed);
    next.add(linkId);
    setDismissed(next);
    try {
      localStorage.setItem(
        "dismissed-link-requests",
        JSON.stringify([...next]),
      );
    } catch {
      // Ignore localStorage errors
    }
  }

  const visible = links.filter((l) => !dismissed.has(l.id));

  if (!loaded || visible.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">
        Link Requests ({visible.length})
      </h3>
      <p className="text-xs text-muted-foreground">
        A kennel manager wants to link your profile to their roster. Accept to
        have their attendance records appear in your logbook.
      </p>
      <div className="space-y-2">
        {visible.map((link) => (
          <div
            key={link.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/30"
          >
            <div className="min-w-0 flex-1 text-sm">
              <Badge variant="outline" className="mr-2 border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300">
                {link.kennelShortName}
              </Badge>
              <span>
                wants to link your profile
                {link.hashName && (
                  <>
                    {" "}as <strong>{link.hashName}</strong>
                  </>
                )}
              </span>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={() => handleAccept(link.id)}
                disabled={isPending}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => handleDismiss(link.id)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
