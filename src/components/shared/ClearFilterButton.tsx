"use client";

import { X } from "lucide-react";

// Rendered inside parent <button> filter triggers — must stay a <span>
// to avoid nested interactive elements (invalid HTML + hydration warnings).
export function ClearFilterButton({ onClick, label }: Readonly<{ onClick: () => void; label: string }>) {
  return (
    <span
      role="button"
      tabIndex={0}
      className="ml-1 rounded-full p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseDown={(e) => { e.preventDefault(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }
      }}
      aria-label={label}
    >
      <X className="h-3 w-3" />
    </span>
  );
}
