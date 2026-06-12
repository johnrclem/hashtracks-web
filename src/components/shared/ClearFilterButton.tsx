"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// A real <button> rendered as a *sibling* of the filter trigger (never nested
// inside it) — see the `relative inline-flex` chip wrappers at each call site.
// Native button semantics give us correct keyboard handling (Enter/Space) for
// free, so no role/tabIndex/onKeyDown is needed (#1140). `stopPropagation`
// keeps a clear click from also toggling the adjacent popover trigger.
export function ClearFilterButton({
  onClick,
  label,
  className,
}: Readonly<{ onClick: () => void; label: string; className?: string }>) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-full p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        // Clearing the filter unmounts this button; move focus back to the
        // sibling trigger first so keyboard users aren't dumped on <body> (#1140).
        const prev = e.currentTarget.previousElementSibling;
        if (prev instanceof HTMLElement) {
          const trigger = prev.tagName === "BUTTON" ? prev : prev.querySelector("button");
          trigger?.focus();
        }
        onClick();
      }}
      aria-label={label}
    >
      <X className="h-3 w-3" />
    </button>
  );
}
