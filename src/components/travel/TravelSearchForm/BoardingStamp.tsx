"use client";

import type { BoardingStampVariant } from "./types";

/**
 * Rotated monospace badge used as the boarding-pass rubber-stamp
 * vocabulary. `leg` — solid red LEG NN marker; `ghost` — dashed
 * muted marker on pending slots; `required` — red, with the
 * travel-stamp-required fade-in animation for submit-refusal.
 */
export function BoardingStamp({
  label,
  variant,
}: Readonly<{
  label: string;
  variant: BoardingStampVariant;
}>) {
  const baseClasses =
    "inline-flex -rotate-[1.5deg] items-center justify-center rounded-sm border-[1.5px] px-1.5 py-[1px] font-mono text-[10px] font-bold uppercase tracking-wider";
  const variantClasses: Record<BoardingStampVariant, string> = {
    leg: "border-red-600/70 text-red-600 dark:border-red-400/70 dark:text-red-400",
    ghost: "border-dashed border-muted-foreground/50 text-muted-foreground",
    required:
      "travel-stamp-required border-red-600/60 text-red-600 ml-2 text-[9px]",
  };
  return (
    <span
      role={variant === "required" ? "status" : undefined}
      aria-live={variant === "required" ? "polite" : undefined}
      className={`${baseClasses} ${variantClasses[variant]}`}
    >
      {label}
    </span>
  );
}
