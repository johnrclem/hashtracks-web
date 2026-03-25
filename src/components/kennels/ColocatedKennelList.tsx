"use client";

import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { KennelPin } from "./ClusteredKennelMarkers";

interface ColocatedKennelListProps {
  pins: KennelPin[];
  onSelectKennel: (id: string) => void;
  onClose: () => void;
}

/** Shared kennel rows rendered inside both mobile sheet and desktop card. */
function KennelRows({
  pins,
  onSelectKennel,
}: {
  pins: KennelPin[];
  onSelectKennel: (id: string) => void;
}) {
  return (
    <div
      className="overflow-y-auto divide-y divide-border/50"
      style={{ maxHeight: 6 * 60 }}
    >
      {pins.map((pin) => (
        <button
          key={pin.id}
          onClick={() => onSelectKennel(pin.id)}
          className="group flex items-center gap-3 w-full text-left px-3 py-2.5 transition-colors hover:bg-accent/50"
          style={{ minHeight: 52 }}
        >
          {/* Region color dot */}
          <span
            className="shrink-0 rounded-full w-2.5 h-2.5 ring-2 ring-offset-1 ring-offset-background"
            style={{ backgroundColor: pin.color }}
          />

          {/* Kennel info */}
          <div className="flex-1 min-w-0 space-y-0.5">
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-semibold truncate">
                {pin.shortName}
              </span>
              {pin.fullName && pin.fullName !== pin.shortName && (
                <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                  {pin.fullName}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {pin.schedule && (
                <span className="truncate">{pin.schedule}</span>
              )}
              {pin.nextEvent && (
                <span className="shrink-0 font-medium text-foreground/80">
                  Next: {pin.nextEvent.date}
                </span>
              )}
            </div>
          </div>

          {/* View link */}
          <Link
            href={`/kennels/${pin.slug}`}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 flex items-center gap-1 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
          >
            View <ExternalLink className="h-3 w-3" />
          </Link>
        </button>
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
  onSelectKennel,
  onClose,
}: ColocatedKennelListProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
        <SheetContent side="bottom" className="px-0 pb-0 max-h-[70vh]" showCloseButton={false}>
          <SheetHeader className="px-4 pb-2">
            <SheetTitle className="text-sm">
              {pins.length} kennels at this location
            </SheetTitle>
          </SheetHeader>
          <KennelRows pins={pins} onSelectKennel={onSelectKennel} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div className="bg-background/95 backdrop-blur-sm border rounded-xl shadow-xl w-[320px] max-w-[calc(100vw-2rem)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b bg-muted/30">
        <span className="text-sm font-semibold">
          {pins.length} kennels at this location
        </span>
        <button
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close kennel list"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <KennelRows pins={pins} onSelectKennel={onSelectKennel} />
    </div>
  );
}
