"use client";

import { useState, useTransition, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, ChevronRight, ChevronLeft, Check, AlertTriangle, FileText } from "lucide-react";
import {
  previewCSVImport,
  executeCSVImport,
} from "@/app/misman/[slug]/import/actions";

type Step = "upload" | "configure" | "preview" | "execute" | "summary";

interface ImportWizardProps {
  kennelId: string;
  kennelShortName: string;
}

interface PreviewData {
  totalRows: number;
  hasherCount: number;
  headerCount: number;
  matchedHashers: {
    csvName: string;
    kennelHasherId: string;
    matchType: "exact" | "fuzzy";
    matchScore: number;
    rosterName: string;
  }[];
  unmatchedHashers: string[];
  matchedEvents: {
    columnHeader: string;
    eventId: string;
    date: string;
  }[];
  unmatchedColumns: string[];
  recordCount: number;
  duplicateCount: number;
  paidCount: number;
  hareCount: number;
}

interface ImportResult {
  created: number;
  duplicateCount: number;
  createdHashers: number;
  unmatchedHashers: number;
  unmatchedColumns: number;
}

export function ImportWizard({ kennelId, kennelShortName }: ImportWizardProps) {
  const [step, setStep] = useState<Step>("upload");
  const [csvText, setCsvText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  // Config
  const [nameColumn, setNameColumn] = useState(0);
  const [dataStartColumn, setDataStartColumn] = useState(1);
  const [headerRow, setHeaderRow] = useState(0);
  const [dataStartRow, setDataStartRow] = useState(1);
  const [fuzzyThreshold, setFuzzyThreshold] = useState(0.85);
  const [createHashers, setCreateHashers] = useState(false);

  // Preview data
  const [preview, setPreview] = useState<PreviewData | null>(null);

  // Result
  const [result, setResult] = useState<ImportResult | null>(null);

  // CSV preview rows
  const csvPreviewRows = csvText
    ? csvText.split("\n").slice(0, 6).map((line) => line.split(",").map((cell) => cell.trim()))
    : [];

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvText(text);
      setStep("configure");
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.endsWith(".csv")) {
      toast.error("Please drop a CSV file");
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvText(text);
      setStep("configure");
    };
    reader.readAsText(file);
  }, []);

  const handlePreview = () => {
    startTransition(async () => {
      const res = await previewCSVImport(kennelId, csvText, {
        nameColumn,
        dataStartColumn,
        headerRow,
        dataStartRow,
        fuzzyThreshold,
      });

      if (res.error) {
        toast.error(res.error);
        return;
      }

      if (res.data) {
        setPreview(res.data);
        setStep("preview");
      }
    });
  };

  const handleExecute = () => {
    startTransition(async () => {
      const res = await executeCSVImport(kennelId, csvText, {
        nameColumn,
        dataStartColumn,
        headerRow,
        dataStartRow,
        fuzzyThreshold,
        createHashers,
      });

      if (res.error) {
        toast.error(res.error);
        return;
      }

      if (res.data) {
        setResult(res.data);
        setStep("summary");
        toast.success(`Imported ${res.data.created} attendance records`);
      }
    });
  };

  const handleReset = () => {
    setCsvText("");
    setFileName("");
    setPreview(null);
    setResult(null);
    setStep("upload");
  };

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {(["upload", "configure", "preview", "execute", "summary"] as Step[]).map((s, i) => (
          <span key={s} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3" />}
            <span className={step === s ? "text-foreground font-medium" : ""}>
              {s === "upload" ? "Upload" : s === "configure" ? "Configure" : s === "preview" ? "Preview" : s === "execute" ? "Import" : "Summary"}
            </span>
          </span>
        ))}
      </div>

      {/* Step: Upload */}
      {step === "upload" && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-12 text-center"
        >
          <Upload className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-medium">Drop a CSV file here</p>
            <p className="text-sm text-muted-foreground">
              Matrix format: rows = hasher names, columns = dates or run numbers
            </p>
          </div>
          <label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button variant="outline" asChild>
              <span>Browse files</span>
            </Button>
          </label>
          <p className="text-xs text-muted-foreground">
            Cell markers: X = attended, P = paid, H = hare
          </p>
        </div>
      )}

      {/* Step: Configure */}
      {step === "configure" && (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span className="text-sm font-medium">{fileName}</span>
            <Badge variant="secondary">{csvPreviewRows.length > 5 ? "5+" : csvPreviewRows.length} rows</Badge>
          </div>

          {/* CSV Preview Table */}
          {csvPreviewRows.length > 0 && (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-xs">
                <tbody>
                  {csvPreviewRows.map((row, rowIdx) => (
                    <tr
                      key={rowIdx}
                      className={
                        rowIdx === headerRow
                          ? "bg-blue-50 dark:bg-blue-950 font-medium"
                          : rowIdx < dataStartRow
                            ? "bg-muted/50"
                            : ""
                      }
                    >
                      <td className="px-2 py-1 text-muted-foreground border-r w-8">
                        {rowIdx}
                      </td>
                      {row.map((cell, colIdx) => (
                        <td
                          key={colIdx}
                          className={`px-2 py-1 border-r whitespace-nowrap ${
                            colIdx === nameColumn
                              ? "bg-green-50 dark:bg-green-950"
                              : colIdx >= dataStartColumn
                                ? "bg-yellow-50 dark:bg-yellow-950"
                                : ""
                          }`}
                        >
                          {cell || <span className="text-muted-foreground">-</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            <span className="inline-block w-3 h-3 bg-green-50 dark:bg-green-950 border mr-1" /> Name column
            <span className="inline-block w-3 h-3 bg-yellow-50 dark:bg-yellow-950 border ml-3 mr-1" /> Data columns
            <span className="inline-block w-3 h-3 bg-blue-50 dark:bg-blue-950 border ml-3 mr-1" /> Header row
          </div>

          {/* Configuration */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Name column</label>
              <input
                type="number"
                min={0}
                value={nameColumn}
                onChange={(e) => setNameColumn(parseInt(e.target.value, 10))}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Data start column</label>
              <input
                type="number"
                min={0}
                value={dataStartColumn}
                onChange={(e) => setDataStartColumn(parseInt(e.target.value, 10))}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Header row</label>
              <input
                type="number"
                min={0}
                value={headerRow}
                onChange={(e) => setHeaderRow(parseInt(e.target.value, 10))}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Data start row</label>
              <input
                type="number"
                min={0}
                value={dataStartRow}
                onChange={(e) => setDataStartRow(parseInt(e.target.value, 10))}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Fuzzy match threshold</label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={fuzzyThreshold}
                onChange={(e) => setFuzzyThreshold(parseFloat(e.target.value))}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("upload")}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <Button onClick={handlePreview} disabled={isPending}>
              {isPending ? "Analyzing..." : "Preview import"}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Step: Preview */}
      {step === "preview" && preview && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded border p-3 text-center">
              <div className="text-2xl font-bold">{preview.recordCount}</div>
              <div className="text-xs text-muted-foreground">Records to import</div>
            </div>
            <div className="rounded border p-3 text-center">
              <div className="text-2xl font-bold">{preview.matchedHashers.length}</div>
              <div className="text-xs text-muted-foreground">Matched hashers</div>
            </div>
            <div className="rounded border p-3 text-center">
              <div className="text-2xl font-bold">{preview.matchedEvents.length}</div>
              <div className="text-xs text-muted-foreground">Matched events</div>
            </div>
            <div className="rounded border p-3 text-center">
              <div className="text-2xl font-bold">{preview.duplicateCount}</div>
              <div className="text-xs text-muted-foreground">Duplicates skipped</div>
            </div>
          </div>

          {/* Unmatched warnings */}
          {(preview.unmatchedHashers.length > 0 || preview.unmatchedColumns.length > 0) && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950">
              <div className="flex items-center gap-2 text-sm font-medium text-yellow-800 dark:text-yellow-200">
                <AlertTriangle className="h-4 w-4" />
                Unmatched items
              </div>

              {preview.unmatchedHashers.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs font-medium text-yellow-700 dark:text-yellow-300">
                    Unmatched hashers ({preview.unmatchedHashers.length}):
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {preview.unmatchedHashers.map((name) => (
                      <Badge key={name} variant="outline" className="text-xs">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {preview.unmatchedColumns.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs font-medium text-yellow-700 dark:text-yellow-300">
                    Unmatched columns ({preview.unmatchedColumns.length}):
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {preview.unmatchedColumns.map((col) => (
                      <Badge key={col} variant="outline" className="text-xs">
                        {col}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Fuzzy matches */}
          {preview.matchedHashers.filter((m) => m.matchType === "fuzzy").length > 0 && (
            <div className="rounded border p-4">
              <div className="text-sm font-medium mb-2">Fuzzy matches (review these):</div>
              <div className="space-y-1 text-xs">
                {preview.matchedHashers
                  .filter((m) => m.matchType === "fuzzy")
                  .map((m) => (
                    <div key={m.csvName} className="flex items-center gap-2">
                      <span className="text-muted-foreground">{m.csvName}</span>
                      <ChevronRight className="h-3 w-3" />
                      <span className="font-medium">{m.rosterName}</span>
                      <Badge variant="secondary" className="text-xs">
                        {(m.matchScore * 100).toFixed(0)}%
                      </Badge>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Matched events */}
          {preview.matchedEvents.length > 0 && (
            <div className="rounded border p-4">
              <div className="text-sm font-medium mb-2">Matched events ({preview.matchedEvents.length}):</div>
              <div className="flex flex-wrap gap-1">
                {preview.matchedEvents.map((e) => (
                  <Badge key={e.eventId} variant="secondary" className="text-xs">
                    {e.columnHeader} ({e.date})
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Create hashers option */}
          {preview.unmatchedHashers.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={createHashers}
                onChange={(e) => setCreateHashers(e.target.checked)}
                className="rounded"
              />
              Create roster entries for {preview.unmatchedHashers.length} unmatched hashers
            </label>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("configure")}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <Button
              onClick={handleExecute}
              disabled={isPending || preview.recordCount === 0}
            >
              {isPending ? "Importing..." : `Import ${preview.recordCount} records`}
              <Check className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Step: Summary */}
      {step === "summary" && result && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-lg font-medium text-green-600">
            <Check className="h-5 w-5" />
            Import complete
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="rounded border p-3 text-center">
              <div className="text-2xl font-bold text-green-600">{result.created}</div>
              <div className="text-xs text-muted-foreground">Records created</div>
            </div>
            <div className="rounded border p-3 text-center">
              <div className="text-2xl font-bold">{result.duplicateCount}</div>
              <div className="text-xs text-muted-foreground">Duplicates skipped</div>
            </div>
            {result.createdHashers > 0 && (
              <div className="rounded border p-3 text-center">
                <div className="text-2xl font-bold">{result.createdHashers}</div>
                <div className="text-xs text-muted-foreground">Hashers created</div>
              </div>
            )}
          </div>

          {(result.unmatchedHashers > 0 || result.unmatchedColumns > 0) && (
            <div className="text-sm text-muted-foreground">
              {result.unmatchedHashers > 0 && (
                <p>{result.unmatchedHashers} hasher names were not matched and skipped.</p>
              )}
              {result.unmatchedColumns > 0 && (
                <p>{result.unmatchedColumns} column headers were not matched to events.</p>
              )}
            </div>
          )}

          <Button onClick={handleReset} variant="outline">
            Import another file
          </Button>
        </div>
      )}
    </div>
  );
}
