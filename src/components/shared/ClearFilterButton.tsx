"use client";

import { X } from "lucide-react";

// Rendered inside parent <button> filter triggers — must stay a <span>
// to avoid nested interactive elements (invalid HTML + hydration warnings).
export function ClearFilterButton({ onClick, label }: Readonly<{ onClick: () => void; label: string }>) {
  const activate = () => onClick();
  return (
    <span
      role="button"
      tabIndex={0}
      className="ml-1 rounded-full p-0.5 hover:bg-muted"
      onClick={(e) => { e.stopPropagation(); activate(); }}
      onMouseDown={(e) => { e.preventDefault(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          activate();
        }
      }}
      aria-label={label}
    >
      <X className="h-3 w-3" />
    </span>
  );
}
