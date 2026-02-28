"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

interface RegionFilterPopoverProps {
  readonly regions: readonly { slug: string; name: string }[];
  readonly selectedRegions: readonly string[];
  readonly onToggle: (slug: string) => void;
}

export function RegionFilterPopover({ regions, selectedRegions, onToggle }: RegionFilterPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs">
          Region
          {selectedRegions.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-xs">
              {selectedRegions.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search regions..." />
          <CommandList>
            <CommandEmpty>No regions found.</CommandEmpty>
            <CommandGroup>
              {regions.map((r) => (
                <CommandItem
                  key={r.slug}
                  value={r.name}
                  onSelect={() => { onToggle(r.slug); }}
                >
                  <span
                    className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                      selectedRegions.includes(r.slug)
                        ? "bg-primary border-primary text-primary-foreground"
                        : "opacity-50"
                    }`}
                  >
                    {selectedRegions.includes(r.slug) && "✓"}
                  </span>
                  {r.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
