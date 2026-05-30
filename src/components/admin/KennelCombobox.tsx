"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type KennelComboboxOption = {
  kennelCode: string;
  shortName: string;
  fullName: string;
};

interface KennelComboboxProps {
  readonly kennels: readonly KennelComboboxOption[];
  /** Currently selected kennelCode, if any. */
  readonly value?: string;
  readonly onSelect: (kennelCode: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** kennelCodes to hide (e.g. kennels already attributed to the event). */
  readonly excludeCodes?: readonly string[];
}

/**
 * Searchable single-kennel picker (Popover + Command) keyed on `kennelCode`.
 * Mirrors the RegionCombobox idiom. Used by the admin kennel-attribution dialog
 * for both "change primary" and "add co-host".
 */
export function KennelCombobox({
  kennels,
  value,
  onSelect,
  placeholder = "Select kennel…",
  disabled,
  excludeCodes = [],
}: KennelComboboxProps) {
  const [open, setOpen] = useState(false);
  const exclude = new Set(excludeCodes);
  const options = kennels.filter((k) => !exclude.has(k.kennelCode));
  const selected = kennels.find((k) => k.kennelCode === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-8 w-full justify-between text-xs font-normal"
        >
          <span className="truncate">
            {selected ? `${selected.shortName} — ${selected.fullName}` : placeholder}
          </span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search kennels…" className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty>No kennel found.</CommandEmpty>
            {options.map((k) => (
              <CommandItem
                key={k.kennelCode}
                value={`${k.shortName} ${k.fullName} ${k.kennelCode}`}
                onSelect={() => {
                  onSelect(k.kennelCode);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-3 w-3",
                    value === k.kennelCode ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="text-xs font-medium">{k.shortName}</span>
                <span className="ml-1 truncate text-xs text-muted-foreground">
                  — {k.fullName}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
