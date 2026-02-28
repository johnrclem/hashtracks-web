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
import { KennelOptionLabel } from "@/components/kennels/KennelOptionLabel";

interface KennelFilterPopoverProps {
  readonly kennels: readonly { id: string; shortName: string; fullName: string; regionName: string }[];
  readonly selectedKennels: readonly string[];
  readonly onToggle: (kennelId: string) => void;
}

export function KennelFilterPopover({ kennels, selectedKennels, onToggle }: KennelFilterPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs">
          Kennel
          {selectedKennels.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-xs">
              {selectedKennels.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search kennels..." />
          <CommandList>
            <CommandEmpty>No kennels found.</CommandEmpty>
            <CommandGroup>
              {kennels.map((kennel) => (
                <CommandItem
                  key={kennel.id}
                  value={`${kennel.shortName} ${kennel.fullName} ${kennel.regionName}`}
                  onSelect={() => onToggle(kennel.id)}
                >
                  <span
                    className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                      selectedKennels.includes(kennel.id)
                        ? "bg-primary border-primary text-primary-foreground"
                        : "opacity-50"
                    }`}
                  >
                    {selectedKennels.includes(kennel.id) && "✓"}
                  </span>
                  <KennelOptionLabel kennel={kennel} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
