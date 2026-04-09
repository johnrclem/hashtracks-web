"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  analyzeHtmlStructure,
  refineHtmlAnalysis,
  type HtmlAnalysisResult,
} from "@/app/admin/sources/analyze-html-action";
import type { GenericHtmlConfig, GenericHtmlColumns } from "@/adapters/html-scraper/generic-types";
import type { KennelOption } from "./KennelTagInput";

// ─── Column field definitions ───────────────────────────────────────────────

const COLUMN_FIELDS: { key: keyof GenericHtmlColumns; label: string; required?: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "kennelTag", label: "Kennel Tag" },
  { key: "title", label: "Title" },
  { key: "hares", label: "Hares" },
  { key: "location", label: "Location" },
  { key: "locationUrl", label: "Location URL" },
  { key: "startTime", label: "Start Time" },
  { key: "runNumber", label: "Run #" },
  { key: "sourceUrl", label: "Source URL" },
];

/** All assignable field keys for sample preview dropdown. */
const FIELD_OPTIONS = [
  { value: "_ignore_", label: "— skip —" },
  ...COLUMN_FIELDS.map((f) => ({ value: f.key, label: f.label })),
];

/** Map confidence level to badge styling. */
function confidenceBadgeClass(level: "high" | "medium" | "low"): string {
  switch (level) {
    case "high": return "border-green-200 text-green-700 dark:border-green-800 dark:text-green-300";
    case "medium": return "border-amber-200 text-amber-700 dark:border-amber-800 dark:text-amber-300";
    case "low": return "border-red-200 text-red-700 dark:border-red-800 dark:text-red-300";
  }
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface GenericHtmlConfigPanelProps {
  readonly config: GenericHtmlConfig | null;
  readonly onChange: (config: GenericHtmlConfig) => void;
  readonly url: string;
  readonly allKennels?: KennelOption[];
}

// ─── Component ──────────────────────────────────────────────────────────────

export function GenericHtmlConfigPanel({
  config,
  onChange,
  url,
  allKennels,
}: GenericHtmlConfigPanelProps) {
  const [isAnalyzing, startAnalyze] = useTransition();
  const [isRefining, startRefine] = useTransition();
  const [analysisResult, setAnalysisResult] = useState<HtmlAnalysisResult | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Current config values
  const containerSelector = config?.containerSelector ?? "";
  const rowSelector = config?.rowSelector ?? "";
  const columns = config?.columns ?? { date: "" };
  const defaultKennelTag = config?.defaultKennelTag ?? "";
  const dateLocale = config?.dateLocale ?? "en-US";

  // Whether the best candidate is a table layout (enables column reassignment dropdowns)
  const isTableLayout = analysisResult?.candidates?.[0]?.layoutType === "table";

  function updateConfig(patch: Partial<GenericHtmlConfig>) {
    onChange({
      containerSelector: config?.containerSelector ?? "",
      rowSelector: config?.rowSelector ?? "",
      columns: config?.columns ?? { date: "" },
      defaultKennelTag: config?.defaultKennelTag ?? "",
      dateLocale: config?.dateLocale ?? "en-US",
      ...patch,
    });
  }

  function updateColumn(key: keyof GenericHtmlColumns, value: string) {
    const newColumns = { ...columns, [key]: value || undefined };
    // Ensure date is always present
    if (!newColumns.date) newColumns.date = "";
    updateConfig({ columns: newColumns as GenericHtmlColumns });
  }

  function handleAnalyze() {
    startAnalyze(async () => {
      try {
        const result = await analyzeHtmlStructure(url);
        setAnalysisResult(result);

        if (result.suggestedConfig) {
          onChange(result.suggestedConfig);
        }
      } catch (err) {
        setAnalysisResult({
          candidates: [],
          suggestedConfig: null,
          explanation: "",
          confidence: null,
          error: `Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
  }

  function handleRefine() {
    startRefine(async () => {
      try {
        const result = await refineHtmlAnalysis(url, config ?? {}, feedbackText);
        setAnalysisResult(result);

        if (result.suggestedConfig) {
          onChange(result.suggestedConfig);
        }
        setFeedbackText("");
      } catch (err) {
        setAnalysisResult((prev) => ({
          candidates: prev?.candidates ?? [],
          suggestedConfig: prev?.suggestedConfig ?? null,
          explanation: "",
          confidence: null,
          error: `Refinement failed: ${err instanceof Error ? err.message : String(err)}`,
        }));
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Phase A: Analyze Page button */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isAnalyzing || !url.trim()}
          onClick={handleAnalyze}
        >
          {isAnalyzing ? "Analyzing…" : "Analyze Page"}
        </Button>
        {analysisResult?.confidence && (
          <Badge
            variant="outline"
            className={confidenceBadgeClass(analysisResult.confidence)}
          >
            {analysisResult.confidence} confidence
          </Badge>
        )}
      </div>

      {/* Analysis result explanation */}
      {analysisResult?.explanation && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          {analysisResult.explanation}
          {analysisResult.candidates.length > 0 && (
            <span className="ml-1">
              ({analysisResult.candidates.length} container{analysisResult.candidates.length === 1 ? "" : "s"} found,{" "}
              {analysisResult.candidates[0]?.rowCount ?? 0} rows)
            </span>
          )}
        </div>
      )}

      {analysisResult?.error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive">
          {analysisResult.error}
        </div>
      )}

      {/* Phase B: Sample Preview with column assignment */}
      {analysisResult?.candidates?.[0]?.sampleRows && analysisResult.candidates[0].sampleRows.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Sample Data Preview</p>
          {!isTableLayout && (
            <p className="text-xs text-muted-foreground">
              Column reassignment is only available for table layouts. Use &quot;Refine with AI&quot; or advanced selectors to adjust mappings.
            </p>
          )}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  {analysisResult.candidates[0].sampleRows[0].map((_, colIdx) => (
                    <th key={`col-${colIdx}`} className="px-2 py-1.5"> {/* NOSONAR: static preview data, never reordered */}
                      {isTableLayout ? (
                        <Select
                          value={getColumnAssignment(columns, colIdx)}
                          onValueChange={(val) => handleColumnReassign(colIdx, val)}
                        >
                          <SelectTrigger className="h-6 w-full min-w-[100px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FIELD_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">Col {colIdx + 1}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analysisResult.candidates[0].sampleRows.slice(0, 5).map((row, rowIdx) => (
                  <tr key={`row-${rowIdx}`} className="border-t"> {/* NOSONAR: static preview data, never reordered */}
                    {row.map((cell, cellIdx) => (
                      <td key={`cell-${rowIdx}-${cellIdx}`} className="max-w-[200px] truncate px-2 py-1 text-muted-foreground">
                        {cell || <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Refine with feedback */}
      {analysisResult && config?.containerSelector && (
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="feedback" className="text-xs">
              Correction / feedback
            </Label>
            <Input
              id="feedback"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder='e.g., "column 3 is hares, not title"'
              className="h-7 text-xs"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={isRefining || !feedbackText.trim()}
            onClick={handleRefine}
          >
            {isRefining ? "Refining…" : "Refine with AI"}
          </Button>
        </div>
      )}

      {/* Default kennel tag */}
      <div className="space-y-1.5">
        <Label htmlFor="generic-kennel-tag" className="text-xs">
          Default Kennel Tag *
        </Label>
        <Input
          id="generic-kennel-tag"
          value={defaultKennelTag}
          onChange={(e) => updateConfig({ defaultKennelTag: e.target.value })}
          placeholder="e.g. DFWH3"
          className="h-8 text-xs"
          list="kennel-suggestions"
        />
        {allKennels && allKennels.length > 0 && (
          <datalist id="kennel-suggestions">
            {allKennels.map((k) => (
              <option key={k.id} value={k.shortName}>
                {k.fullName}
              </option>
            ))}
          </datalist>
        )}
      </div>

      {/* Date locale */}
      <div className="space-y-1.5">
        <Label htmlFor="generic-date-locale" className="text-xs">
          Date Format
        </Label>
        <Select value={dateLocale} onValueChange={(val) => updateConfig({ dateLocale: val as "en-US" | "en-GB" })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en-US" className="text-xs">US (MM/DD — March 15, 2026)</SelectItem>
            <SelectItem value="en-GB" className="text-xs">UK (DD/MM — 15th March 2026)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Phase C: Advanced CSS selectors (collapsible) */}
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        {showAdvanced ? "Hide advanced selectors" : "Show advanced selectors"}
      </button>

      {showAdvanced && (
        <div className="space-y-3 rounded-md border bg-muted/10 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="generic-container" className="text-xs">
                Container Selector
              </Label>
              <Input
                id="generic-container"
                value={containerSelector}
                onChange={(e) => updateConfig({ containerSelector: e.target.value })}
                placeholder='e.g. #events, table.runs'
                className="h-7 font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="generic-row" className="text-xs">
                Row Selector
              </Label>
              <Input
                id="generic-row"
                value={rowSelector}
                onChange={(e) => updateConfig({ rowSelector: e.target.value })}
                placeholder='e.g. tbody tr, .event-card'
                className="h-7 font-mono text-xs"
              />
            </div>
          </div>

          <p className="text-xs font-medium">Column Selectors</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {COLUMN_FIELDS.map((field) => (
              <div key={field.key} className="space-y-0.5">
                <Label htmlFor={`col-${field.key}`} className="text-xs">
                  {field.label}{field.required ? " *" : ""}
                </Label>
                <Input
                  id={`col-${field.key}`}
                  value={(columns as unknown as Record<string, string | undefined>)[field.key] ?? ""}
                  onChange={(e) => updateColumn(field.key, e.target.value)}
                  placeholder={`e.g. td:nth-child(${COLUMN_FIELDS.indexOf(field) + 1})`}
                  className="h-7 font-mono text-xs"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // ─── Column assignment helpers (table layouts only) ────────────────

  /**
   * Given current column config, determine which field is assigned to a
   * column index (for the sample preview dropdowns).
   */
  function getColumnAssignment(cols: GenericHtmlColumns, colIdx: number): string {
    const selector = `td:nth-child(${colIdx + 1})`;
    for (const field of COLUMN_FIELDS) {
      const val = (cols as unknown as Record<string, string | undefined>)[field.key];
      if (val === selector) return field.key;
    }
    return "_ignore_";
  }

  /**
   * When admin changes a column assignment dropdown, update the config
   * to map that column index to the selected field.
   */
  function handleColumnReassign(colIdx: number, fieldKey: string) {
    const selector = `td:nth-child(${colIdx + 1})`;
    const newColumns = { ...columns };

    // Remove this selector from any other field
    for (const field of COLUMN_FIELDS) {
      if (newColumns[field.key] === selector) {
        newColumns[field.key] = undefined as unknown as string;
      }
    }

    // Assign to selected field (or skip if _ignore_)
    if (fieldKey !== "_ignore_") {
      (newColumns as unknown as Record<string, string | undefined>)[fieldKey] = selector;
    }

    // Ensure date always has a value
    if (!newColumns.date) newColumns.date = "";

    updateConfig({ columns: newColumns as GenericHtmlColumns });
  }
}
