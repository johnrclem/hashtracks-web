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
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type RegionOption = {
  id: string;
  name: string;
  country: string;
  abbrev: string;
};

interface RegionComboboxProps {
  readonly value: string;
  readonly regions: RegionOption[];
  readonly onSelect: (regionId: string) => void;
  readonly size?: "sm" | "default";
  readonly id?: string;
}

export function RegionCombobox({
  value,
  regions,
  onSelect,
  size = "default",
  id,
}: RegionComboboxProps) {
  const [open, setOpen] = useState(false);
  const selectedRegion = regions.find((r) => r.id === value);
  const isSmall = size === "sm";

  const displayText = selectedRegion
    ? isSmall
      ? selectedRegion.name
      : `${selectedRegion.name} (${selectedRegion.abbrev})`
    : "Select region...";

  const grouped = regions.reduce<Record<string, RegionOption[]>>((acc, r) => {
    if (!acc[r.country]) acc[r.country] = [];
    acc[r.country].push(r);
    return acc;
  }, {});

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            isSmall && "h-7 text-xs",
          )}
        >
          {displayText}
          <ChevronsUpDown
            className={cn(
              "shrink-0 opacity-50",
              isSmall ? "ml-1 h-3 w-3" : "ml-2 h-4 w-4",
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("p-0", isSmall ? "w-[280px]" : "w-[300px]")}
        align="start"
      >
        <Command>
          <CommandInput
            placeholder="Search regions..."
            className={isSmall ? "h-8 text-xs" : undefined}
          />
          <CommandList>
            <CommandEmpty>No region found.</CommandEmpty>
            {Object.entries(grouped).map(([country, countryRegions]) => (
              <CommandGroup key={country} heading={country}>
                {countryRegions.map((r) => (
                  <CommandItem
                    key={r.id}
                    value={`${r.name} ${r.abbrev}`}
                    onSelect={() => {
                      onSelect(r.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        isSmall ? "mr-2 h-3 w-3" : "mr-2 h-4 w-4",
                        value === r.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {isSmall ? (
                      <span className="text-xs">{r.name}</span>
                    ) : (
                      r.name
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {r.abbrev}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
