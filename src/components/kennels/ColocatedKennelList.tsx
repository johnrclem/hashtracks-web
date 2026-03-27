"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ChevronRight, X } from "lucide-react";
import { track } from "@vercel/analytics";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
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
  showRegion,
}: {
  pins: KennelPin[];
  onClose: () => void;
  showRegion: boolean;
}) {
  return (
    <div className="overflow-y-auto divide-y divide-border/50 max-h-[360px]">
      {pins.map((pin) => (
        <Link
          key={pin.id}
          href={`/kennels/${pin.slug}`}
          className="group flex items-start gap-3 w-full text-left px-3 py-2.5 transition-colors hover:bg-accent/50"
          style={{ minHeight: 60, borderLeft: `3px solid ${pin.color}` }}
          onClick={onClose}
        >
          <div className="flex-1 min-w-0 space-y-0.5">
            {/* Line 1: shortName + region badge */}
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold truncate">
                {pin.shortName}
              </span>
              {showRegion && (
                <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
                  {pin.region}
                </Badge>
              )}
            </div>

            {/* Line 2: fullName */}
            <p className="text-xs text-muted-foreground truncate">
              {pin.fullName}
            </p>

            {/* Line 3: schedule + next run with title */}
            <p className="text-xs text-muted-foreground truncate">
              {pin.schedule && <>{pin.schedule} · </>}
              {pin.nextEvent ? (
                <span className="font-medium text-foreground/80">
                  Next: {formatDateShort(pin.nextEvent.date)}
                  {pin.nextEvent.title && (
                    <span className="font-normal text-muted-foreground">
                      {" "}— {pin.nextEvent.title}
                    </span>
                  )}
                </span>
              ) : (
                <span className="italic">No upcoming runs</span>
              )}
            </p>
          </div>

          <ChevronRight className="shrink-0 mt-1.5 h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
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

  const allSameRegion = pins.every((p) => p.region === pins[0]?.region);
  const region = allSameRegion ? pins[0]?.region : null;
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
          <KennelRows pins={pins} onClose={onClose} showRegion={!allSameRegion} />
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
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close kennel list"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <KennelRows pins={pins} onClose={onClose} showRegion={!allSameRegion} />
    </div>
  );
}
