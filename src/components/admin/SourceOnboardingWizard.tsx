"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSource, createQuickKennel } from "@/app/admin/sources/actions";
import { detectSourceType } from "@/lib/source-detect";
import {
  previewSourceConfig,
  type PreviewData,
} from "@/app/admin/sources/preview-action";
import { PreviewResults } from "./PreviewResults";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

const SOURCE_TYPES = [
  "HTML_SCRAPER",
  "GOOGLE_CALENDAR",
  "GOOGLE_SHEETS",
  "ICAL_FEED",
  "HASHREGO",
  "MEETUP",
  "RSS_FEED",
  "JSON_API",
  "MANUAL",
] as const;

const SOURCE_TYPE_DESCRIPTIONS: Record<string, string> = {
  HTML_SCRAPER: "Website with event table/list (Cheerio-based)",
  GOOGLE_CALENDAR: "Google Calendar API v3 feed",
  GOOGLE_SHEETS: "Published Google Sheets spreadsheet",
  ICAL_FEED: "iCal/ICS calendar feed",
  HASHREGO: "Hash Rego event aggregator",
  MEETUP: "Meetup.com public group (no API key needed)",
  RSS_FEED: "RSS/Atom event feed",
  JSON_API: "JSON API endpoint",
  MANUAL: "Manually entered events",
};

/** Types that use the config JSON field */
const CONFIG_TYPES = new Set([
  "GOOGLE_CALENDAR",
  "GOOGLE_SHEETS",
  "ICAL_FEED",
  "HASHREGO",
  "MEETUP",
  "RSS_FEED",
]);

/** Types that get a dedicated config panel */
const PANEL_TYPES = new Set([
  "GOOGLE_CALENDAR",
  "ICAL_FEED",
  "HASHREGO",
  "GOOGLE_SHEETS",
  "MEETUP",
  "RSS_FEED",
]);

const STEPS = [
  { id: "url", label: "URL" },
  { id: "details", label: "Details" },
  { id: "config", label: "Config" },
  { id: "kennels", label: "Kennels" },
  { id: "test", label: "Test" },
  { id: "review", label: "Review" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

interface SourceOnboardingWizardProps {
  allKennels: {
    id: string;
    shortName: string;
    fullName: string;
    region: string;
  }[];
  geminiAvailable?: boolean;
}

function hasICalConfigShape(config: unknown): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return false;
  const obj = config as Record<string, unknown>;
  return (
    "kennelPatterns" in obj ||
    "defaultKennelTag" in obj ||
    "skipPatterns" in obj
  );
}

export function SourceOnboardingWizard({
  allKennels,
  geminiAvailable,
}: SourceOnboardingWizardProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<StepId>("url");

  // Form state
  const [urlValue, setUrlValue] = useState("");
  const [detectedType, setDetectedType] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState("HTML_SCRAPER");
  const [name, setName] = useState("");
  const [trustLevel, setTrustLevel] = useState(5);
  const [scrapeFreq, setScrapeFreq] = useState("daily");
  const [scrapeDays, setScrapeDays] = useState(90);
  const [selectedKennels, setSelectedKennels] = useState<string[]>([]);
  const [configObj, setConfigObj] = useState<Record<string, unknown> | null>(
    null,
  );
  const [configJson, setConfigJson] = useState("");
  const [showRawJson, setShowRawJson] = useState(false);

  // Preview state
  const [isPreviewing, startPreview] = useTransition();
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sampleTitlesByTag, setSampleTitlesByTag] = useState<
    Record<string, string[]>
  >({});

  // Quick kennel state
  const [extraKennels, setExtraKennels] = useState<typeof allKennels>([]);
  const [quickKennelOpen, setQuickKennelOpen] = useState(false);
  const [quickKennelShortName, setQuickKennelShortName] = useState("");
  const [quickKennelFullName, setQuickKennelFullName] = useState("");
  const [quickKennelRegion, setQuickKennelRegion] = useState("");
  const [isCreatingKennel, startCreatingKennel] = useTransition();

  // Submit state
  const [isSubmitting, startSubmitting] = useTransition();

  // Kennel search filter
  const [kennelSearch, setKennelSearch] = useState("");

  const allKennelsWithExtra = [...allKennels, ...extraKennels];
  const currentStepIndex = STEPS.findIndex((s) => s.id === currentStep);

  const showConfigEditor = CONFIG_TYPES.has(selectedType);
  const hasPanel =
    PANEL_TYPES.has(selectedType) ||
    (selectedType === "HTML_SCRAPER" && hasICalConfigShape(configObj));

  function getPanelType(): "ical" | "calendar" | "hashrego" | "sheets" | "meetup" | "rss" | null {
    if (
      selectedType === "ICAL_FEED" ||
      (selectedType === "HTML_SCRAPER" && hasICalConfigShape(configObj))
    )
      return "ical";
    if (selectedType === "GOOGLE_CALENDAR") return "calendar";
    if (selectedType === "HASHREGO") return "hashrego";
    if (selectedType === "GOOGLE_SHEETS") return "sheets";
    if (selectedType === "MEETUP") return "meetup";
    if (selectedType === "RSS_FEED") return "rss";
    return null;
  }

  const panelType = getPanelType();

  function handleUrlDetect() {
    const detected = detectSourceType(urlValue);
    if (detected) {
      setSelectedType(detected.type);
      setDetectedType(detected.type);

      if (detected.extractedUrl) {
        setUrlValue(detected.extractedUrl);
      }

      if (detected.sheetId && configObj?.sheetId !== detected.sheetId) {
        const next = { ...(configObj ?? {}), sheetId: detected.sheetId };
        setConfigObj(next);
        setConfigJson(JSON.stringify(next, null, 2));
      }

      if (detected.type === "MEETUP" && detected.groupUrlname && configObj?.groupUrlname !== detected.groupUrlname) {
        const next = { ...(configObj ?? {}), groupUrlname: detected.groupUrlname };
        setConfigObj(next);
        setConfigJson(JSON.stringify(next, null, 2));
      }
    } else {
      setDetectedType(null);
    }
  }

  function handleConfigChange(
    newConfig: CalendarConfig | ICalConfig | HashRegoConfig | SheetsConfig | MeetupConfig,
  ) {
    const entries = Object.entries(newConfig).filter(
      ([, v]) => v !== undefined,
    );
    const cleaned = Object.fromEntries(entries) as Record<string, unknown>;
    const hasContent = entries.length > 0;
    setConfigObj(hasContent ? cleaned : null);
    setConfigJson(hasContent ? JSON.stringify(cleaned, null, 2) : "");
  }

  function handleRawJsonChange(json: string) {
    setConfigJson(json);
    if (!json.trim()) {
      setConfigObj(null);
      return;
    }
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        setConfigObj(parsed);
      }
    } catch {
      // Invalid JSON — don't update configObj, user is still typing
    }
  }

  function toggleKennel(kennelId: string) {
    setSelectedKennels((prev) =>
      prev.includes(kennelId)
        ? prev.filter((id) => id !== kennelId)
        : [...prev, kennelId],
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
      if (!result.success) {
        toast.error(result.error);
      } else {
        const { success, ...newKennel } = result;
        setExtraKennels((prev) => [...prev, newKennel]);
        setSelectedKennels((prev) => [...prev, newKennel.id]);
        resetQuickKennelForm();
        toast.success(`Kennel "${newKennel.shortName}" created and linked`);
      }
    });
  }

  const runPreview = useCallback(() => {
    const fd = new FormData();
    fd.set("url", urlValue);
    fd.set("type", selectedType);
    if (configJson.trim()) {
      fd.set("config", configJson.trim());
    }

    startPreview(async () => {
      setPreviewError(null);
      const result = await previewSourceConfig(fd);
      if (result.error) {
        setPreviewError(result.error);
        setPreviewData(null);
        setSampleTitlesByTag({});
      } else if (result.data) {
        setPreviewData(result.data);
        setPreviewError(null);
        const titles = result.data.events.reduce<Record<string, string[]>>(
          (acc, e) => {
            if (!e.resolved && e.title) {
              (acc[e.kennelTag] ??= []).push(e.title);
            }
            return acc;
          },
          {},
        );
        setSampleTitlesByTag(titles);
      }
    });
  }, [urlValue, selectedType, configJson]);

  function handleSubmit() {
    const fd = new FormData();
    fd.set("name", name);
    fd.set("url", urlValue);
    fd.set("type", selectedType);
    fd.set("trustLevel", String(trustLevel));
    fd.set("scrapeFreq", scrapeFreq);
    fd.set("scrapeDays", String(scrapeDays));
    fd.set("kennelIds", selectedKennels.join(","));
    if (configJson.trim()) {
      fd.set("config", configJson.trim());
    }

    startSubmitting(async () => {
      const result = await createSource(fd);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Source created successfully");
        router.push("/admin/sources");
        router.refresh();
      }
    });
  }

  function goNext() {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex].id);
    }
  }

  function goBack() {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEPS[prevIndex].id);
    }
  }

  function canAdvance(): boolean {
    switch (currentStep) {
      case "url":
        return urlValue.trim().length > 0;
      case "details":
        return name.trim().length > 0;
      case "config":
        return true;
      case "kennels":
        return true;
      case "test":
        return true;
      case "review":
        return true;
      default:
        return false;
    }
  }

  // Filter kennels by search term
  const filteredKennels = kennelSearch.trim()
    ? allKennelsWithExtra.filter(
        (k) =>
          k.shortName.toLowerCase().includes(kennelSearch.toLowerCase()) ||
          k.fullName.toLowerCase().includes(kennelSearch.toLowerCase()) ||
          k.region.toLowerCase().includes(kennelSearch.toLowerCase()),
      )
    : allKennelsWithExtra;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Add New Source</h2>
          <p className="text-sm text-muted-foreground">
            Follow the steps to onboard a new data source
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/sources">Cancel</Link>
        </Button>
      </div>

      {/* Step indicator */}
      <nav aria-label="Onboarding steps">
        <ol className="flex items-center gap-1">
          {STEPS.map((step, i) => {
            const isActive = step.id === currentStep;
            const isCompleted = i < currentStepIndex;
            return (
              <li key={step.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    // Allow jumping to completed steps or current
                    if (i <= currentStepIndex) setCurrentStep(step.id);
                  }}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isCompleted
                        ? "bg-primary/10 text-primary cursor-pointer hover:bg-primary/20"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                      isActive
                        ? "bg-primary-foreground text-primary"
                        : isCompleted
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted-foreground/20 text-muted-foreground"
                    }`}
                  >
                    {isCompleted ? "\u2713" : i + 1}
                  </span>
                  <span className="hidden sm:inline">{step.label}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <span
                    className={`hidden h-px w-4 sm:block ${
                      i < currentStepIndex ? "bg-primary" : "bg-muted"
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step content */}
      <Card>
        {/* Step 1: URL */}
        {currentStep === "url" && (
          <>
            <CardHeader>
              <CardTitle>Source URL</CardTitle>
              <CardDescription>
                Paste the URL of the data source. The type will be
                auto-detected when possible.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="url">URL *</Label>
                <Input
                  id="url"
                  value={urlValue}
                  onChange={(e) => setUrlValue(e.target.value)}
                  onBlur={handleUrlDetect}
                  placeholder="https://hashnyc.com or a Google Calendar/Sheets URL"
                  autoFocus
                />
                {detectedType && (
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="border-blue-300 text-blue-700"
                    >
                      Detected:{" "}
                      {detectedType.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Type auto-filled from URL
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">Source Type *</Label>
                <Select
                  value={selectedType}
                  onValueChange={(val) => {
                    setSelectedType(val);
                    setDetectedType(null);
                    if (!CONFIG_TYPES.has(val)) {
                      setConfigJson("");
                      setConfigObj(null);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {SOURCE_TYPE_DESCRIPTIONS[selectedType]}
                </p>
              </div>
            </CardContent>
          </>
        )}

        {/* Step 2: Details */}
        {currentStep === "details" && (
          <>
            <CardHeader>
              <CardTitle>Source Details</CardTitle>
              <CardDescription>
                Name the source and configure scraping behavior.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. HashNYC Website, Boston Hash Calendar"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  A human-readable name for this source.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="trustLevel">Trust Level (1-10)</Label>
                  <Input
                    id="trustLevel"
                    type="number"
                    min={1}
                    max={10}
                    value={trustLevel}
                    onChange={(e) => setTrustLevel(parseInt(e.target.value) || 5)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Higher = preferred when merging duplicate events.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="scrapeFreq">Scrape Frequency</Label>
                  <Select value={scrapeFreq} onValueChange={setScrapeFreq}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="every_6h">Every 6 Hours</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="scrapeDays">Lookback Window (days)</Label>
                <Input
                  id="scrapeDays"
                  type="number"
                  min={1}
                  max={365}
                  value={scrapeDays}
                  onChange={(e) => setScrapeDays(parseInt(e.target.value) || 90)}
                />
                <p className="text-xs text-muted-foreground">
                  How far back to look when scraping. Default: 90 days.
                </p>
              </div>
            </CardContent>
          </>
        )}

        {/* Step 3: Configuration */}
        {currentStep === "config" && (
          <>
            <CardHeader>
              <CardTitle>Adapter Configuration</CardTitle>
              <CardDescription>
                {showConfigEditor
                  ? "Configure adapter-specific settings for this source type."
                  : "This source type does not require additional configuration. You can proceed to the next step."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {panelType === "calendar" && (
                <CalendarConfigPanel
                  config={configObj as CalendarConfig | null}
                  onChange={handleConfigChange}
                  unmatchedTags={previewData?.unmatchedTags ?? []}
                  sampleTitlesByTag={sampleTitlesByTag}
                  geminiAvailable={geminiAvailable}
                />
              )}

              {panelType === "ical" && (
                <ICalConfigPanel
                  config={configObj as ICalConfig | null}
                  onChange={handleConfigChange}
                  unmatchedTags={previewData?.unmatchedTags ?? []}
                  sampleTitlesByTag={sampleTitlesByTag}
                  geminiAvailable={geminiAvailable}
                />
              )}

              {panelType === "hashrego" && (
                <HashRegoConfigPanel
                  config={configObj as HashRegoConfig | null}
                  onChange={handleConfigChange}
                />
              )}

              {panelType === "sheets" && (
                <SheetsConfigPanel
                  config={configObj as SheetsConfig | null}
                  onChange={handleConfigChange}
                  sampleRows={previewData?.sampleRows}
                  geminiAvailable={geminiAvailable}
                />
              )}

              {panelType === "meetup" && (
                <MeetupConfigPanel
                  config={configObj as MeetupConfig | null}
                  onChange={handleConfigChange}
                />
              )}

              {panelType === "rss" && (
                <RssConfigPanel
                  config={configObj as RssConfig | null}
                  onChange={handleConfigChange}
                />
              )}

              {/* Raw JSON editor */}
              {showConfigEditor && (
                <div className="space-y-2">
                  {hasPanel ? (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setShowRawJson(!showRawJson)}
                    >
                      {showRawJson
                        ? "Hide raw JSON"
                        : "Show raw JSON (advanced)"}
                    </button>
                  ) : (
                    <Label htmlFor="config">Adapter Config (JSON)</Label>
                  )}
                  {(!hasPanel || showRawJson) && (
                    <>
                      <textarea
                        id="config"
                        className="min-h-[120px] w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                        value={configJson}
                        onChange={(e) => handleRawJsonChange(e.target.value)}
                        placeholder='{"defaultKennelTag": "EWH3"}'
                      />
                      <p className="text-xs text-muted-foreground">
                        Adapter-specific configuration. See docs for your source
                        type.
                      </p>
                    </>
                  )}
                </div>
              )}

              {!showConfigEditor && (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  <p>
                    No configuration needed for{" "}
                    {selectedType.replace(/_/g, " ").toLowerCase()} sources.
                  </p>
                  <p className="mt-1 text-xs">
                    HTML scrapers use URL-based adapter routing.
                  </p>
                </div>
              )}
            </CardContent>
          </>
        )}

        {/* Step 4: Link Kennels */}
        {currentStep === "kennels" && (
          <>
            <CardHeader>
              <CardTitle>Link Kennels</CardTitle>
              <CardDescription>
                Select the kennels this source provides data for. This controls
                the source-kennel guard in the merge pipeline.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Input
                  placeholder="Search kennels..."
                  value={kennelSearch}
                  onChange={(e) => setKennelSearch(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>

              <TooltipProvider>
                <div className="flex max-h-64 flex-wrap gap-1 overflow-y-auto rounded-md border p-2">
                  {filteredKennels.map((kennel) => (
                    <Tooltip key={kennel.id}>
                      <TooltipTrigger asChild>
                        <Badge
                          variant={
                            selectedKennels.includes(kennel.id)
                              ? "default"
                              : "outline"
                          }
                          className="cursor-pointer"
                          onClick={() => toggleKennel(kennel.id)}
                        >
                          {kennel.shortName}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        {kennel.fullName}
                        {kennel.region ? ` \u2014 ${kennel.region}` : ""}
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

              {/* Quick kennel creation */}
              {quickKennelOpen && (
                <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                  <p className="text-xs font-medium">Create New Kennel</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="qk-shortName" className="text-xs">
                        Short Name *
                      </Label>
                      <Input
                        id="qk-shortName"
                        value={quickKennelShortName}
                        onChange={(e) =>
                          setQuickKennelShortName(e.target.value)
                        }
                        placeholder="NYCH3"
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="qk-region" className="text-xs">
                        Region *
                      </Label>
                      <Input
                        id="qk-region"
                        value={quickKennelRegion}
                        onChange={(e) => setQuickKennelRegion(e.target.value)}
                        placeholder="New York City, NY"
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="qk-fullName" className="text-xs">
                      Full Name *
                    </Label>
                    <Input
                      id="qk-fullName"
                      value={quickKennelFullName}
                      onChange={(e) => setQuickKennelFullName(e.target.value)}
                      placeholder="New York City Hash House Harriers"
                      className="h-7 text-xs"
                    />
                  </div>
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
                      {isCreatingKennel ? "Creating\u2026" : "Create & Link"}
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
            </CardContent>
          </>
        )}

        {/* Step 5: Test Config */}
        {currentStep === "test" && (
          <>
            <CardHeader>
              <CardTitle>Test Configuration</CardTitle>
              <CardDescription>
                Run a live test to verify the source fetches events correctly
                before saving.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPreviewing || !urlValue.trim()}
                  onClick={runPreview}
                >
                  {isPreviewing ? "Testing\u2026" : "Run Test"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Fetches events using the current URL and config without
                  saving.
                </span>
              </div>

              {previewError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3">
                  <p className="text-sm text-destructive">{previewError}</p>
                </div>
              )}

              {previewData && (
                <PreviewResults
                  data={previewData}
                  allKennels={allKennelsWithExtra}
                  onAliasCreated={runPreview}
                />
              )}

              {!previewData && !previewError && !isPreviewing && (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Click &ldquo;Run Test&rdquo; to fetch sample events from the
                  source.
                </div>
              )}
            </CardContent>
          </>
        )}

        {/* Step 6: Review & Create */}
        {currentStep === "review" && (
          <>
            <CardHeader>
              <CardTitle>Review & Create</CardTitle>
              <CardDescription>
                Review the source configuration before creating it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3 rounded-md border p-4 text-sm">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      Name
                    </span>
                    <p>{name || <span className="text-destructive">Not set</span>}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      Type
                    </span>
                    <p>
                      <Badge variant="outline">{selectedType}</Badge>
                    </p>
                  </div>
                </div>

                <div>
                  <span className="text-xs font-medium text-muted-foreground">
                    URL
                  </span>
                  <p className="break-all text-xs">
                    {urlValue || (
                      <span className="text-destructive">Not set</span>
                    )}
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      Trust Level
                    </span>
                    <p>{trustLevel}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      Frequency
                    </span>
                    <p>{scrapeFreq}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      Lookback
                    </span>
                    <p>{scrapeDays} days</p>
                  </div>
                </div>

                {configObj && Object.keys(configObj).length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      Config
                    </span>
                    <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 font-mono text-xs">
                      {JSON.stringify(configObj, null, 2)}
                    </pre>
                  </div>
                )}

                <div>
                  <span className="text-xs font-medium text-muted-foreground">
                    Linked Kennels ({selectedKennels.length})
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {selectedKennels.length > 0 ? (
                      selectedKennels.map((id) => {
                        const kennel = allKennelsWithExtra.find(
                          (k) => k.id === id,
                        );
                        return (
                          <Badge key={id} variant="secondary" className="text-xs">
                            {kennel?.shortName ?? id}
                          </Badge>
                        );
                      })
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No kennels linked
                      </span>
                    )}
                  </div>
                </div>

                {previewData && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      Test Results
                    </span>
                    <p className="text-xs">
                      {previewData.totalCount} events found,{" "}
                      {previewData.unmatchedTags.length} unmatched tags,{" "}
                      {previewData.errors.length} errors
                    </p>
                  </div>
                )}
              </div>

              {/* Validation warnings */}
              {!name.trim() && (
                <p className="text-sm text-destructive">
                  Source name is required. Go back to the Details step.
                </p>
              )}
              {!urlValue.trim() && (
                <p className="text-sm text-destructive">
                  Source URL is required. Go back to the URL step.
                </p>
              )}
            </CardContent>
          </>
        )}

        {/* Navigation footer */}
        <div className="flex items-center justify-between border-t px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={goBack}
            disabled={currentStepIndex === 0}
          >
            Back
          </Button>

          <div className="flex gap-2">
            {currentStep === "review" ? (
              <Button
                type="button"
                disabled={
                  isSubmitting || !name.trim() || !urlValue.trim()
                }
                onClick={handleSubmit}
              >
                {isSubmitting ? "Creating\u2026" : "Create Source"}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={goNext}
                disabled={!canAdvance()}
              >
                Next
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
