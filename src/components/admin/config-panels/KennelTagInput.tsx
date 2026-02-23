"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

export interface KennelOption {
  id: string;
  shortName: string;
  fullName: string;
  region: string;
}

interface KennelTagInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly allKennels?: KennelOption[];
  readonly placeholder?: string;
  readonly id?: string;
  readonly className?: string;
}

/**
 * Text input with optional kennel autocomplete dropdown.
 * Falls back to plain Input when allKennels is not provided.
 * Allows free-text entry for new/unknown tags.
 */
export function KennelTagInput({
  value,
  onChange,
  allKennels,
  placeholder = "e.g., EWH3",
  id,
  className,
}: KennelTagInputProps) {
  const [open, setOpen] = useState(false);

  if (!allKennels || allKennels.length === 0) {
    return (
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
      />
    );
  }

  const filtered = value.trim()
    ? allKennels
        .filter(
          (k) =>
            k.shortName.toLowerCase().includes(value.toLowerCase()) ||
            k.fullName.toLowerCase().includes(value.toLowerCase()),
        )
        .slice(0, 8)
    : allKennels.slice(0, 8);

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
          {filtered.map((k) => (
            <button
              key={k.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(k.shortName);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span className="w-16 shrink-0 font-mono text-xs font-medium">
                {k.shortName}
              </span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {k.fullName}
              </span>
              {k.region && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  · {k.region}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
