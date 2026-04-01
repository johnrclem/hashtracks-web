"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SCHEDULE_DAYS } from "@/lib/days";
import { toggleArrayItem } from "@/lib/format";
import { ClearFilterButton } from "@/components/shared/ClearFilterButton";

interface DayOfWeekSelectProps {
  readonly selectedDays: string[];
  readonly onDaysChange: (days: string[]) => void;
}

export function DayOfWeekSelect({ selectedDays, onDaysChange }: DayOfWeekSelectProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={selectedDays.length > 0 ? "secondary" : "outline"}
          size="sm"
          className={`h-8 text-xs ${selectedDays.length > 0 ? "border-primary/50" : ""}`}
        >
          {selectedDays.length > 0 ? selectedDays.join(", ") : "Run Day"}
          {selectedDays.length > 1 && (
            <Badge variant="secondary" className="ml-1 text-xs">
              {selectedDays.length}
            </Badge>
          )}
          {selectedDays.length > 0 && (
            <ClearFilterButton onClick={() => onDaysChange([])} label="Clear day filter" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-0" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              {SCHEDULE_DAYS.map((day) => (
                <CommandItem
                  key={day}
                  onSelect={() => onDaysChange(toggleArrayItem(selectedDays, day))}
                >
                  <span
                    className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                      selectedDays.includes(day)
                        ? "bg-primary border-primary text-primary-foreground"
                        : "opacity-50"
                    }`}
                  >
                    {selectedDays.includes(day) && "✓"}
                  </span>
                  {day}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
