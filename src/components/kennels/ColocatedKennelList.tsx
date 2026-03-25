"use client";

import Link from "next/link";
import { X } from "lucide-react";
import type { KennelPin } from "./ClusteredKennelMarkers";

interface ColocatedKennelListProps {
  pins: KennelPin[];
  onSelectKennel: (id: string) => void;
  onClose: () => void;
}

export function ColocatedKennelList({ pins, onSelectKennel, onClose }: ColocatedKennelListProps) {
  return (
    <div className="bg-background border rounded-lg shadow-lg p-2 w-[260px] max-h-[340px] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-1.5 border-b mb-1">
        <span className="text-xs font-semibold text-muted-foreground">
          {pins.length} kennels at this location
        </span>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close kennel list"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Scrollable list — max ~6 rows visible then scroll */}
      <div className="overflow-y-auto flex-1" style={{ maxHeight: 6 * 52 }}>
        {pins.map((pin) => (
          <button
            key={pin.id}
            onClick={() => onSelectKennel(pin.id)}
            className="flex items-center gap-2 w-full text-left px-1.5 py-2 rounded hover:bg-muted/50 transition-colors"
            style={{ minHeight: 44 }}
          >
            {/* Region color dot */}
            <span
              className="shrink-0 rounded-full"
              style={{
                width: 8,
                height: 8,
                backgroundColor: pin.color,
              }}
            />

            {/* Kennel info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate leading-tight">{pin.shortName}</p>
              {pin.schedule && (
                <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">
                  {pin.schedule}
                </p>
              )}
            </div>

            {/* View link */}
            <Link
              href={`/kennels/${pin.slug}`}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 text-xs font-medium text-primary hover:underline"
            >
              View &rarr;
            </Link>
          </button>
        ))}
      </div>
    </div>
  );
}
