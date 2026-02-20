"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StringArrayEditor } from "./StringArrayEditor";

export interface SheetsConfig {
  sheetId?: string;
  tabs?: string[];
  columns?: {
    runNumber?: number;
    specialRun?: number;
    date?: number;
    hares?: number;
    location?: number;
    title?: number;
    description?: number;
  };
  kennelTagRules?: {
    default?: string;
    specialRunMap?: Record<string, string>;
    numericSpecialTag?: string;
  };
  startTimeRules?: {
    byDayOfWeek?: Record<string, string>;
    default?: string;
  };
}

interface SheetsConfigPanelProps {
  config: SheetsConfig | null;
  onChange: (config: SheetsConfig) => void;
}

const REQUIRED_COLUMNS = [
  { key: "runNumber", label: "Run Number *" },
  { key: "date", label: "Date *" },
  { key: "hares", label: "Hares *" },
  { key: "location", label: "Location *" },
  { key: "title", label: "Title *" },
] as const;

const OPTIONAL_COLUMNS = [
  { key: "specialRun", label: "Special Run" },
  { key: "description", label: "Description" },
] as const;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

type ColumnKey = (typeof REQUIRED_COLUMNS)[number]["key"] | (typeof OPTIONAL_COLUMNS)[number]["key"];

export function SheetsConfigPanel({
  config,
  onChange,
}: SheetsConfigPanelProps) {
  const current = config ?? {};
  const columns = current.columns ?? {};
  const tagRules = current.kennelTagRules ?? {};
  const specialRunEntries = Object.entries(tagRules.specialRunMap ?? {});
  const [showTimeRules, setShowTimeRules] = useState(
    !!current.startTimeRules,
  );

  function updateColumn(key: ColumnKey, raw: string) {
    const val = raw === "" ? undefined : parseInt(raw, 10);
    const updated = { ...columns, [key]: val };
    // Clean undefined values from optional columns
    if (val === undefined) delete (updated as Record<string, unknown>)[key];
    onChange({ ...current, columns: updated });
  }

  function updateTagRules(partial: Partial<typeof tagRules>) {
    const updated = { ...tagRules, ...partial };
    // Clean undefined values
    const cleaned = Object.fromEntries(
      Object.entries(updated).filter(([, v]) => v !== undefined),
    );
    onChange({
      ...current,
      kennelTagRules: Object.keys(cleaned).length > 0 ? cleaned : undefined,
    });
  }

  function updateSpecialRunMap(entries: [string, string][]) {
    const map =
      entries.length > 0 ? Object.fromEntries(entries) : undefined;
    updateTagRules({ specialRunMap: map });
  }

  function updateTimeRules(
    partial: Partial<NonNullable<SheetsConfig["startTimeRules"]>>,
  ) {
    const existing = current.startTimeRules ?? {};
    const updated = { ...existing, ...partial };
    onChange({ ...current, startTimeRules: updated });
  }

  function updateDayTime(day: string, time: string) {
    const existing = current.startTimeRules?.byDayOfWeek ?? {};
    const updated = { ...existing };
    if (time) {
      updated[day] = time;
    } else {
      delete updated[day];
    }
    updateTimeRules({
      byDayOfWeek: Object.keys(updated).length > 0 ? updated : undefined,
    });
  }

  return (
    <div className="space-y-4">
      {/* Section 1: Sheet Identity */}
      <div className="space-y-2">
        <Label htmlFor="sheetId">Sheet ID *</Label>
        <Input
          id="sheetId"
          value={current.sheetId ?? ""}
          onChange={(e) =>
            onChange({
              ...current,
              sheetId: e.target.value || undefined,
            })
          }
          placeholder="e.g., 1wG-BNb5ekMHM5euiPJT1nxQXZ3UxNqFZ..."
          className="text-sm font-mono"
        />
        <p className="text-xs text-muted-foreground">
          The Google Sheets document ID from the spreadsheet URL.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Tabs</Label>
        <p className="text-xs text-muted-foreground">
          Explicit tab names to read. Leave empty to auto-discover
          year-prefixed tabs (2024, 2025, etc.).
        </p>
        <StringArrayEditor
          items={current.tabs ?? []}
          onChange={(tabs) =>
            onChange({
              ...current,
              tabs: tabs.length > 0 ? tabs : undefined,
            })
          }
          placeholder="Tab name"
          addLabel="Add Tab"
        />
      </div>

      {/* Section 2: Column Mapping */}
      <div className="space-y-2">
        <Label>Column Mapping</Label>
        <p className="text-xs text-muted-foreground">
          0-indexed column positions in the spreadsheet. Required columns
          marked with *.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {REQUIRED_COLUMNS.map(({ key, label }) => (
            <div key={key} className="space-y-1">
              <Label className="text-xs">{label}</Label>
              <Input
                type="number"
                min="0"
                value={columns[key] ?? ""}
                onChange={(e) => updateColumn(key, e.target.value)}
                className="text-sm"
              />
            </div>
          ))}
          {OPTIONAL_COLUMNS.map(({ key, label }) => (
            <div key={key} className="space-y-1">
              <Label className="text-xs text-muted-foreground">{label}</Label>
              <Input
                type="number"
                min="0"
                value={columns[key] ?? ""}
                onChange={(e) => updateColumn(key, e.target.value)}
                className="text-sm"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Section 3: Kennel Tag Rules */}
      <div className="space-y-3">
        <Label>Kennel Tag Rules</Label>

        <div className="space-y-1">
          <Label className="text-xs">Default Tag *</Label>
          <Input
            value={tagRules.default ?? ""}
            onChange={(e) =>
              updateTagRules({
                default: e.target.value || undefined,
              })
            }
            placeholder="e.g., Summit"
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Fallback kennel tag when no special run rules match.
          </p>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            Special Run Map
          </Label>
          <p className="text-xs text-muted-foreground">
            Map special run names to kennel tags (e.g., &quot;ASSSH3&quot; →
            &quot;ASSSH3&quot;).
          </p>
          <div className="space-y-2">
            {specialRunEntries.map(([name, tag], i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  placeholder="Special run name"
                  value={name}
                  onChange={(e) => {
                    const updated: [string, string][] = specialRunEntries.map(
                      ([n, t], j) =>
                        j === i ? [e.target.value, t] : [n, t],
                    );
                    updateSpecialRunMap(updated);
                  }}
                  className="flex-1 text-xs"
                />
                <Input
                  placeholder="Kennel tag"
                  value={tag}
                  onChange={(e) => {
                    const updated: [string, string][] = specialRunEntries.map(
                      ([n, t], j) =>
                        j === i ? [n, e.target.value] : [n, t],
                    );
                    updateSpecialRunMap(updated);
                  }}
                  className="w-32 text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    updateSpecialRunMap(
                      specialRunEntries
                        .filter((_, j) => j !== i)
                        .map(([n, t]) => [n, t]),
                    )
                  }
                >
                  &times;
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                updateSpecialRunMap([...specialRunEntries.map(([n, t]): [string, string] => [n, t]), ["", ""]])
              }
            >
              Add Special Run
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            Numeric Special Tag
          </Label>
          <Input
            value={tagRules.numericSpecialTag ?? ""}
            onChange={(e) =>
              updateTagRules({
                numericSpecialTag: e.target.value || undefined,
              })
            }
            placeholder="e.g., SFM"
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Kennel tag for rows with a number in the special run column.
          </p>
        </div>
      </div>

      {/* Section 4: Start Time Rules (optional, collapsible) */}
      <div className="space-y-2">
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (showTimeRules) {
              // Clear time rules when collapsing
              const { startTimeRules: _, ...rest } = current;
              onChange(rest);
            }
            setShowTimeRules(!showTimeRules);
          }}
        >
          {showTimeRules
            ? "Remove start time rules"
            : "Add start time rules (optional)"}
        </button>

        {showTimeRules && (
          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <div className="space-y-1">
              <Label className="text-xs">Default Time</Label>
              <Input
                value={current.startTimeRules?.default ?? ""}
                onChange={(e) =>
                  updateTimeRules({
                    default: e.target.value || undefined,
                  })
                }
                placeholder="e.g., 15:00"
                className="w-32 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Fallback time in HH:MM format for unmatched days.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">By Day of Week</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DAYS.map((day) => (
                  <div key={day} className="space-y-0.5">
                    <Label className="text-xs text-muted-foreground">
                      {day}
                    </Label>
                    <Input
                      value={
                        current.startTimeRules?.byDayOfWeek?.[day] ?? ""
                      }
                      onChange={(e) => updateDayTime(day, e.target.value)}
                      placeholder="HH:MM"
                      className="text-sm"
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Override start times by day of week. Leave empty for days
                that use the default.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
