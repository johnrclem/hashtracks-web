"use client";

import { useEffect } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { track } from "@vercel/analytics";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDateShort } from "@/lib/format";
import type { KennelPin } from "./ClusteredKennelMarkers";

interface ColocatedKennelListProps {
  pins: KennelPin[];
  onClose: () => void;
}

/** Shared kennel rows rendered inside both mobile sheet and desktop card. */
function KennelRows({
  pins,
  onClose,
}: {
  pins: KennelPin[];
  onClose: () => void;
}) {
  return (
    <div className="overflow-y-auto divide-y divide-border/50 max-h-[360px]">
      {pins.map((pin) => (
        <Link
          key={pin.id}
          href={`/kennels/${pin.slug}`}
          className="group flex items-center gap-3 w-full text-left px-3 py-2.5 transition-colors hover:bg-accent/50"
          style={{ minHeight: 52, borderLeft: `3px solid ${pin.color}` }}
          onClick={onClose}
        >
          <div className="flex-1 min-w-0 space-y-0.5">
            <p className="text-sm font-semibold">{pin.shortName}</p>
            <p className="text-xs text-muted-foreground">
              {pin.schedule && <>{pin.schedule} &middot; </>}
              {pin.nextEvent ? (
                <span className="font-medium text-foreground/80">
                  Next: {formatDateShort(pin.nextEvent.date)}
                </span>
              ) : (
                <span className="italic">No upcoming runs</span>
              )}
            </p>
          </div>

          <span className="shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors">
            &rsaquo;
          </span>
        </Link>
      ))}
    </div>
  );
}

/**
 * Kennel list picker shown when a user clicks a stacked pin (multiple kennels
 * at the same coordinates) on the kennel map.
 *
 * Mobile (<1024px): renders as a bottom Sheet.
 * Desktop: renders as an inline card overlay.
 */
export function ColocatedKennelList({
  pins,
  onClose,
}: Readonly<ColocatedKennelListProps>) {
  const isMobile = useIsMobile();

  useEffect(() => {
    track("map_colocated_kennel_popover", { kennelCount: pins.length });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const region = pins[0]?.region;
  const headerText = region
    ? `${pins.length} kennels in ${region}`
    : `${pins.length} kennels at this location`;

  if (isMobile) {
    return (
      <Sheet open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
        <SheetContent side="bottom" className="px-0 pb-0 max-h-[70vh]" showCloseButton={false}>
          <SheetHeader className="px-4 pb-2">
            <SheetTitle className="text-sm">
              {headerText}
            </SheetTitle>
          </SheetHeader>
          <KennelRows pins={pins} onClose={onClose} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div className="bg-background/95 backdrop-blur-sm border rounded-xl shadow-xl w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b bg-muted/30">
        <span className="text-sm font-semibold">
          {headerText}
        </span>
        <button
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close kennel list"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <KennelRows pins={pins} onClose={onClose} />
    </div>
  );
}
