"use client";

import { X } from "lucide-react";

/** Small inline clear button used inside filter trigger buttons. */
export function ClearFilterButton({ onClick, label }: Readonly<{ onClick: () => void; label: string }>) {
  return (
    <span
      className="ml-1 rounded-full p-0.5 hover:bg-muted"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseDown={(e) => { e.preventDefault(); }}
      aria-label={label}
    >
      <X className="h-3 w-3" />
    </span>
  );
}
