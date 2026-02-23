"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import { createQuickKennel } from "@/app/admin/sources/actions";
import {
  previewSourceConfig,
  type PreviewData,
} from "@/app/admin/sources/preview-action";
import {
  suggestSourceConfig,
  type ConfigSuggestion,
} from "@/app/admin/sources/suggest-source-config-action";
import { PreviewResults } from "./PreviewResults";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  CalendarConfigPanel,
  type CalendarConfig,
} from "./config-panels/CalendarConfigPanel";
import {
  ICalConfigPanel,
  type ICalConfig,
} from "./config-panels/ICalConfigPanel";
import {
  HashRegoConfigPanel,
  type HashRegoConfig,
} from "./config-panels/HashRegoConfigPanel";
import {
  SheetsConfigPanel,
  type SheetsConfig,
} from "./config-panels/SheetsConfigPanel";
import {
  MeetupConfigPanel,
  type MeetupConfig,
} from "./config-panels/MeetupConfigPanel";
import {
  RssConfigPanel,
  type RssConfig,
} from "./config-panels/RssConfigPanel";
import type { KennelOption } from "./config-panels/KennelTagInput";

/** Types that use the config JSON field */
const CONFIG_TYPES = new Set([
  "GOOGLE_CALENDAR",
  "GOOGLE_SHEETS",
  "ICAL_FEED",
  "HASHREGO",
  "MEETUP",
  "RSS_FEED",
]);

/** Types that get a dedicated config panel UI */
const PANEL_TYPES = new Set([
  "GOOGLE_CALENDAR",
  "ICAL_FEED",
  "HASHREGO",
  "GOOGLE_SHEETS",
  "MEETUP",
  "RSS_FEED",
]);

function hasICalConfigShape(config: unknown): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const obj = config as Record<string, unknown>;
  return "kennelPatterns" in obj || "defaultKennelTag" in obj || "skipPatterns" in obj;
}

/** File-private: compact labeled Input for the quick-kennel inline form. */
function QuickKennelField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        className="h-7 text-xs"
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </div>
  );
}

export interface ConfigureAndTestProps {
  readonly url: string;
  readonly type: string;
  readonly config: Record<string, unknown> | null;
  readonly configJson: string;
  readonly selectedKennels: string[];
  readonly allKennels: KennelOption[];
  readonly geminiAvailable?: boolean;
  readonly onConfigChange: (config: Record<string, unknown> | null, json: string) => void;
  readonly onKennelsChange: (ids: string[]) => void;
}

export function ConfigureAndTest({
  url,
  type,
  config,
  configJson,
  selectedKennels,
  allKennels,
  geminiAvailable,
  onConfigChange,
  onKennelsChange,
}: ConfigureAndTestProps) {
  // Preview state
  const [isPreviewing, startPreview] = useTransition();
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sampleTitlesByTag, setSampleTitlesByTag] = useState<Record<string, string[]>>({});
  const [lastRunTime, setLastRunTime] = useState<Date | null>(null);
  const [hasRunTest, setHasRunTest] = useState(false);

  // Quick kennel creation state
  const [extraKennels, setExtraKennels] = useState<KennelOption[]>([]);
  const [quickKennelOpen, setQuickKennelOpen] = useState(false);
  const [quickKennelShortName, setQuickKennelShortName] = useState("");
  const [quickKennelFullName, setQuickKennelFullName] = useState("");
  const [quickKennelRegion, setQuickKennelRegion] = useState("");
  const [isCreatingKennel, startCreatingKennel] = useTransition();

  // Kennel search
  const [kennelSearch, setKennelSearch] = useState("");

  // Show raw JSON toggle
  const [showRawJson, setShowRawJson] = useState(false);

  // AI config suggestion state
  type AiSuggestionState = "idle" | "loading" | "done" | "dismissed" | "error";
  const [aiState, setAiState] = useState<AiSuggestionState>("idle");
  const [aiSuggestion, setAiSuggestion] = useState<ConfigSuggestion | null>(null);

  const allKennelsWithExtra = [...allKennels, ...extraKennels];

  const showConfigEditor = CONFIG_TYPES.has(type);
  const hasPanel =
    PANEL_TYPES.has(type) || (type === "HTML_SCRAPER" && hasICalConfigShape(config));

  function getPanelType(): "ical" | "calendar" | "hashrego" | "sheets" | "meetup" | "rss" | null {
    if (type === "ICAL_FEED" || (type === "HTML_SCRAPER" && hasICalConfigShape(config)))
      return "ical";
    if (type === "GOOGLE_CALENDAR") return "calendar";
    if (type === "HASHREGO") return "hashrego";
    if (type === "GOOGLE_SHEETS") return "sheets";
    if (type === "MEETUP") return "meetup";
    if (type === "RSS_FEED") return "rss";
    return null;
  }

  const panelType = getPanelType();

  // Auto-trigger AI config suggestion on mount when config is empty
  const TYPES_WITH_AI_SUGGESTION = new Set([
    "GOOGLE_CALENDAR",
    "ICAL_FEED",
    "HTML_SCRAPER",
    "RSS_FEED",
    "MEETUP",
    "HASHREGO",
  ]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!TYPES_WITH_AI_SUGGESTION.has(type)) return;
    if (type !== "HTML_SCRAPER" && !geminiAvailable) return;
    if (configJson.trim()) return; // skip if already configured
    if (!url.trim()) return;
    setAiState("loading");
    suggestSourceConfig(url, type)
      .then((result) => {
        if ("error" in result) { setAiState("error"); return; }
        setAiSuggestion(result.suggestion);
        setAiState("done");
      })
      .catch(() => setAiState("error"));
  }, []); // Only on mount

  // Auto-run on mount if config is non-empty
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (configJson.trim() && url.trim()) {
      runPreview();
    }
  }, []); // Only on mount

  const runPreviewWithConfig = useCallback(
    (overrideJson: string) => {
      const fd = new FormData();
      fd.set("url", url);
      fd.set("type", type);
      if (overrideJson.trim()) fd.set("config", overrideJson.trim());

      startPreview(async () => {
        setPreviewError(null);
        const result = await previewSourceConfig(fd);
        setLastRunTime(new Date());
        setHasRunTest(true);

        if (result.error) {
          setPreviewError(result.error);
          setPreviewData(null);
          setSampleTitlesByTag({});
        } else if (result.data) {
          setPreviewData(result.data);
          const resolvedIds = new Set(
            result.data.events
              .filter((e) => e.resolved && e.resolvedKennelId)
              .map((e) => e.resolvedKennelId!),
          );
          const newIds = [...resolvedIds].filter((id) => !selectedKennels.includes(id));
          if (newIds.length > 0) onKennelsChange([...selectedKennels, ...newIds]);
          const titles = result.data.events.reduce<Record<string, string[]>>((acc, e) => {
            if (!e.resolved && e.title) {
              if (!acc[e.kennelTag]) acc[e.kennelTag] = [];
              acc[e.kennelTag].push(e.title);
            }
            return acc;
          }, {});
          setSampleTitlesByTag(titles);
        }
      });
    },
    [url, type, selectedKennels, onKennelsChange],
  );

  const runPreview = useCallback(() => {
    const fd = new FormData();
    fd.set("url", url);
    fd.set("type", type);
    if (configJson.trim()) fd.set("config", configJson.trim());

    startPreview(async () => {
      setPreviewError(null);
      const result = await previewSourceConfig(fd);
      setLastRunTime(new Date());
      setHasRunTest(true);

      if (result.error) {
        setPreviewError(result.error);
        setPreviewData(null);
        setSampleTitlesByTag({});
      } else if (result.data) {
        setPreviewData(result.data);

        // Auto-select resolved kennels (additive — don't deselect already-linked kennels)
        const resolvedIds = new Set(
          result.data.events
            .filter((e) => e.resolved && e.resolvedKennelId)
            .map((e) => e.resolvedKennelId!),
        );
        const newIds = [...resolvedIds].filter((id) => !selectedKennels.includes(id));
        if (newIds.length > 0) {
          onKennelsChange([...selectedKennels, ...newIds]);
        }

        // Build sample titles map for AI suggestions in panels
        const titles = result.data.events.reduce<Record<string, string[]>>((acc, e) => {
          if (!e.resolved && e.title) {
            if (!acc[e.kennelTag]) acc[e.kennelTag] = [];
            acc[e.kennelTag].push(e.title);
          }
          return acc;
        }, {});
        setSampleTitlesByTag(titles);
      }
    });
  }, [url, type, configJson, selectedKennels, onKennelsChange]);

  function handleConfigChange(
    newConfig: CalendarConfig | ICalConfig | HashRegoConfig | SheetsConfig | MeetupConfig,
  ) {
    const entries = Object.entries(newConfig).filter(([, v]) => v !== undefined);
    const cleaned = Object.fromEntries(entries) as Record<string, unknown>;
    const hasContent = entries.length > 0;
    const newObj = hasContent ? cleaned : null;
    const newJson = hasContent ? JSON.stringify(cleaned, null, 2) : "";
    onConfigChange(newObj, newJson);
  }

  function handleRawJsonChange(json: string) {
    if (!json.trim()) {
      onConfigChange(null, "");
      return;
    }
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        onConfigChange(parsed, json);
      } else {
        // Invalid shape — update json only so user can keep typing
        onConfigChange(config, json);
      }
    } catch {
      // Invalid JSON — update json only, don't clear configObj
      onConfigChange(config, json);
    }
  }

  function handleAcceptSuggestion() {
    if (!aiSuggestion) return;
    const json = JSON.stringify(aiSuggestion.suggestedConfig, null, 2);
    onConfigChange(
      Object.keys(aiSuggestion.suggestedConfig).length > 0 ? aiSuggestion.suggestedConfig : null,
      json,
    );
    const suggestedIds = aiSuggestion.suggestedKennelTags
      .flatMap((tag) => allKennelsWithExtra.filter((k) => k.shortName === tag).map((k) => k.id));
    const newIds = suggestedIds.filter((id) => !selectedKennels.includes(id));
    if (newIds.length > 0) onKennelsChange([...selectedKennels, ...newIds]);
    setAiState("dismissed");
    if (Object.keys(aiSuggestion.suggestedConfig).length > 0) {
      runPreviewWithConfig(json);
    }
  }

  function toggleKennel(id: string) {
    onKennelsChange(
      selectedKennels.includes(id)
        ? selectedKennels.filter((x) => x !== id)
        : [...selectedKennels, id],
    );
  }

  function resetQuickKennelForm() {
    setQuickKennelOpen(false);
    setQuickKennelShortName("");
    setQuickKennelFullName("");
    setQuickKennelRegion("");
  }

  function handleQuickKennelCreate() {
    startCreatingKennel(async () => {
      const result = await createQuickKennel({
        shortName: quickKennelShortName.trim(),
        fullName: quickKennelFullName.trim(),
        region: quickKennelRegion.trim(),
      });
      if (result.success) {
        const { success, ...newKennel } = result;
        setExtraKennels((prev) => [...prev, newKennel]);
        onKennelsChange([...selectedKennels, newKennel.id]);
        resetQuickKennelForm();
        toast.success(`Kennel "${newKennel.shortName}" created and linked`);
      } else {
        toast.error(result.error);
      }
    });
  }

  const filteredKennels = kennelSearch.trim()
    ? allKennelsWithExtra.filter(
        (k) =>
          k.shortName.toLowerCase().includes(kennelSearch.toLowerCase()) ||
          k.fullName.toLowerCase().includes(kennelSearch.toLowerCase()) ||
          k.region.toLowerCase().includes(kennelSearch.toLowerCase()),
      )
    : allKennelsWithExtra;

  const lastRunLabel = lastRunTime
    ? lastRunTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    : null;

  const runOrRerunLabel = hasRunTest ? "Re-run Test" : "Run Test";
  const testButtonLabel = isPreviewing ? "Testing…" : runOrRerunLabel;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* ── Left panel: Config ── */}
      <div className="space-y-4 lg:w-[40%]">
        {/* AI Config Suggestion Banner */}
        {aiState === "loading" && (
          <div className="flex animate-pulse items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            ✨ Analyzing source…
          </div>
        )}
        {aiState === "done" && aiSuggestion && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  ✨ AI Suggestion
                  <Badge variant="outline" className="text-xs">{aiSuggestion.confidence}</Badge>
                  {aiSuggestion.adapterNote && (
                    <Badge variant="secondary" className="text-xs">{aiSuggestion.adapterNote}</Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{aiSuggestion.explanation}</p>
              </div>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => setAiState("dismissed")}
              >
                ✕
              </button>
            </div>
            {Object.keys(aiSuggestion.suggestedConfig).length > 0 && (
              <Button size="sm" variant="secondary" onClick={handleAcceptSuggestion}>
                Accept &amp; Test
              </Button>
            )}
          </div>
        )}

        {/* Type-specific config panel */}
        {panelType === "calendar" && (
          <CalendarConfigPanel
            config={config as CalendarConfig | null}
            onChange={handleConfigChange}
            unmatchedTags={previewData?.unmatchedTags ?? []}
            sampleTitlesByTag={sampleTitlesByTag}
            geminiAvailable={geminiAvailable}
            allKennels={allKennelsWithExtra}
          />
        )}

        {panelType === "ical" && (
          <ICalConfigPanel
            config={config as ICalConfig | null}
            onChange={handleConfigChange}
            unmatchedTags={previewData?.unmatchedTags ?? []}
            sampleTitlesByTag={sampleTitlesByTag}
            geminiAvailable={geminiAvailable}
            allKennels={allKennelsWithExtra}
          />
        )}

        {panelType === "hashrego" && (
          <HashRegoConfigPanel
            config={config as HashRegoConfig | null}
            onChange={handleConfigChange}
          />
        )}

        {panelType === "sheets" && (
          <SheetsConfigPanel
            config={config as SheetsConfig | null}
            onChange={handleConfigChange}
            sampleRows={previewData?.sampleRows}
            geminiAvailable={geminiAvailable}
            allKennels={allKennelsWithExtra}
          />
        )}

        {panelType === "meetup" && (
          <MeetupConfigPanel
            config={config as MeetupConfig | null}
            onChange={handleConfigChange}
            allKennels={allKennelsWithExtra}
          />
        )}

        {panelType === "rss" && (
          <RssConfigPanel
            config={config as RssConfig | null}
            onChange={handleConfigChange}
          />
        )}

        {/* No config needed */}
        {!showConfigEditor && !hasPanel && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            <p>No configuration needed for {type.replaceAll("_", " ").toLowerCase()} sources.</p>
            {type === "HTML_SCRAPER" && (
              <p className="mt-1 text-xs">URL routing selects the scraper automatically.</p>
            )}
          </div>
        )}

        {/* Raw JSON toggle */}
        {showConfigEditor && (
          <div className="space-y-2">
            {hasPanel && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowRawJson(!showRawJson)}
              >
                {showRawJson ? "Hide raw JSON" : "Show raw JSON (advanced)"}
              </button>
            )}
            {(!hasPanel || showRawJson) && (
              <>
                {!hasPanel && <Label htmlFor="raw-config">Adapter Config (JSON)</Label>}
                <textarea
                  id="raw-config"
                  className="min-h-[120px] w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                  value={configJson}
                  onChange={(e) => handleRawJsonChange(e.target.value)}
                  placeholder='{"defaultKennelTag": "EWH3"}'
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Right panel: Test + Kennels ── */}
      <div className="space-y-4 lg:w-[60%]">
        {/* Test button row */}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={isPreviewing || !url.trim()}
            onClick={runPreview}
          >
            {testButtonLabel}
          </Button>
          {lastRunLabel && (
            <span className="text-xs text-muted-foreground">Last run: {lastRunLabel}</span>
          )}
        </div>

        {/* Error */}
        {previewError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3">
            <p className="text-sm text-destructive">{previewError}</p>
          </div>
        )}

        {/* Results summary */}
        {previewData && (
          <div className="space-y-1">
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {previewData.totalCount} events found
              </span>
              {previewData.fillRates.title != null && (
                <span>Title {previewData.fillRates.title}%</span>
              )}
              {previewData.fillRates.location != null && (
                <span>Location {previewData.fillRates.location}%</span>
              )}
              {previewData.errors.length > 0 && (
                <span className="text-destructive">{previewData.errors.length} errors</span>
              )}
            </div>
            <PreviewResults
              data={previewData}
              allKennels={allKennelsWithExtra}
              onAliasCreated={runPreview}
            />
          </div>
        )}

        {!previewData && !previewError && !isPreviewing && (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Click &ldquo;Run Test&rdquo; to fetch sample events from the source.
          </div>
        )}

        <Separator />

        {/* Kennel selection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">
              Linked Kennels{" "}
              <span className="font-normal text-muted-foreground">
                ({selectedKennels.length} selected)
              </span>
            </Label>
          </div>

          <Input
            placeholder="Search kennels…"
            value={kennelSearch}
            onChange={(e) => setKennelSearch(e.target.value)}
            className="h-8 text-sm"
          />

          <TooltipProvider>
            <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto rounded-md border p-2">
              {filteredKennels.map((kennel) => (
                <Tooltip key={kennel.id}>
                  <TooltipTrigger asChild>
                    <Badge
                      variant={selectedKennels.includes(kennel.id) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleKennel(kennel.id)}
                    >
                      {kennel.shortName}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {kennel.fullName}
                    {kennel.region ? ` — ${kennel.region}` : ""}
                  </TooltipContent>
                </Tooltip>
              ))}
              {filteredKennels.length === 0 && (
                <p className="px-2 py-4 text-xs text-muted-foreground">
                  No kennels match your search.
                </p>
              )}
            </div>
          </TooltipProvider>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Click to toggle. {selectedKennels.length} selected.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setQuickKennelOpen(true)}
            >
              + New Kennel
            </Button>
          </div>

          {/* Quick kennel creation inline form */}
          {quickKennelOpen && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-medium">Create New Kennel</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <QuickKennelField
                  id="qk-shortName"
                  label="Short Name *"
                  value={quickKennelShortName}
                  onChange={setQuickKennelShortName}
                  placeholder="NYCH3"
                />
                <QuickKennelField
                  id="qk-region"
                  label="Region *"
                  value={quickKennelRegion}
                  onChange={setQuickKennelRegion}
                  placeholder="New York City, NY"
                />
              </div>
              <QuickKennelField
                id="qk-fullName"
                label="Full Name *"
                value={quickKennelFullName}
                onChange={setQuickKennelFullName}
                placeholder="New York City Hash House Harriers"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={
                    isCreatingKennel ||
                    !quickKennelShortName.trim() ||
                    !quickKennelFullName.trim() ||
                    !quickKennelRegion.trim()
                  }
                  onClick={handleQuickKennelCreate}
                >
                  {isCreatingKennel ? "Creating…" : "Create & Link"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={resetQuickKennelForm}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
