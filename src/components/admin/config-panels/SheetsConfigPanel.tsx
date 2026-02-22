"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StringArrayEditor } from "./StringArrayEditor";
import {
  getGeminiSheetsSuggestions,
  type SheetsColumnSuggestion,
  type SheetsColumnField,
} from "@/app/admin/sources/gemini-sheets-action";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  /** Raw CSV rows from first tab — enables "✨ Suggest Columns" button */
  sampleRows?: string[][];
  /** Whether GEMINI_API_KEY is configured */
  geminiAvailable?: boolean;
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

function confidenceClasses(confidence: number): string {
  if (confidence >= 0.8) return "border-green-300 bg-green-50 text-green-800";
  if (confidence >= 0.5) return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-gray-200 bg-gray-50 text-gray-600";
}

export function SheetsConfigPanel({
  config,
  onChange,
  sampleRows,
  geminiAvailable,
}: SheetsConfigPanelProps) {
  const current = config ?? {};
  const columns = current.columns ?? {};
  const tagRules = current.kennelTagRules ?? {};
  const specialRunEntries = Object.entries(tagRules.specialRunMap ?? {});
  const [showTimeRules, setShowTimeRules] = useState(
    !!current.startTimeRules,
  );

  // AI column suggestion state
  const [aiSuggestions, setAiSuggestions] = useState<SheetsColumnSuggestion[] | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isSuggesting, startSuggesting] = useTransition();

  const suggestionByField = new Map<SheetsColumnField, SheetsColumnSuggestion>(
    (aiSuggestions ?? []).map((s) => [s.field, s]),
  );

  const showAiButton =
    geminiAvailable &&
    sampleRows &&
    sampleRows.length > 0 &&
    aiSuggestions === null &&
    !isSuggesting;

  function handleSuggestColumns() {
    setAiError(null);
    startSuggesting(async () => {
      const result = await getGeminiSheetsSuggestions(
        sampleRows!,
        config as Record<string, unknown> | null,
      );
      if (result.error) {
        setAiError(result.error);
      } else {
        setAiSuggestions(result.suggestions ?? []);
      }
    });
  }

  function acceptSuggestion(s: SheetsColumnSuggestion) {
    const key = s.field as ColumnKey;
    const updated = { ...columns, [key]: s.columnIndex };
    onChange({ ...current, columns: updated });
    setAiSuggestions((prev) => (prev ? prev.filter((x) => x.field !== s.field) : prev));
  }

  function acceptAll() {
    if (!aiSuggestions) return;
    const updated = { ...columns };
    for (const s of aiSuggestions) {
      (updated as Record<string, number | undefined>)[s.field] = s.columnIndex;
    }
    onChange({ ...current, columns: updated });
    setAiSuggestions([]);
  }

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
        <div className="flex items-center justify-between">
          <Label>Column Mapping</Label>
          {showAiButton && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={handleSuggestColumns}
            >
              ✨ Suggest Columns
            </Button>
          )}
          {isSuggesting && (
            <span className="text-xs text-muted-foreground animate-pulse">Thinking…</span>
          )}
          {aiSuggestions && aiSuggestions.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs border-green-300 text-green-700 hover:bg-green-50"
              onClick={acceptAll}
            >
              ✓ Accept All
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          0-indexed column positions in the spreadsheet. Required columns
          marked with *.
        </p>
        {aiError && (
          <p className="text-xs text-destructive">{aiError}</p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {REQUIRED_COLUMNS.map(({ key, label }) => {
            const suggestion = suggestionByField.get(key as SheetsColumnField);
            return (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <Input
                  type="number"
                  min="0"
                  value={columns[key] ?? ""}
                  onChange={(e) => updateColumn(key, e.target.value)}
                  className="text-sm"
                />
                {suggestion && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => acceptSuggestion(suggestion)}
                        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-mono cursor-pointer hover:opacity-80 ${confidenceClasses(suggestion.confidence)}`}
                      >
                        → col {suggestion.columnIndex} ({Math.round(suggestion.confidence * 100)}%) ✓
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="text-xs">{suggestion.reason}</p>
                      {suggestion.sampleValues.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Samples: {suggestion.sampleValues.join(", ")}
                        </p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            );
          })}
          {OPTIONAL_COLUMNS.map(({ key, label }) => {
            const suggestion = suggestionByField.get(key as SheetsColumnField);
            return (
              <div key={key} className="space-y-1">
                <Label className="text-xs text-muted-foreground">{label}</Label>
                <Input
                  type="number"
                  min="0"
                  value={columns[key] ?? ""}
                  onChange={(e) => updateColumn(key, e.target.value)}
                  className="text-sm"
                />
                {suggestion && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => acceptSuggestion(suggestion)}
                        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-mono cursor-pointer hover:opacity-80 ${confidenceClasses(suggestion.confidence)}`}
                      >
                        → col {suggestion.columnIndex} ({Math.round(suggestion.confidence * 100)}%) ✓
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="text-xs">{suggestion.reason}</p>
                      {suggestion.sampleValues.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Samples: {suggestion.sampleValues.join(", ")}
                        </p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            );
          })}
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
                updateSpecialRunMap([...specialRunEntries, ["", ""]])
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
