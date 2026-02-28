"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSource } from "@/app/admin/sources/actions";
import { detectSourceType } from "@/lib/source-detect";
import { suggestSourceName } from "@/app/admin/sources/suggest-source-name-action";
import { ConfigureAndTest } from "./ConfigureAndTest";
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
import { toast } from "sonner";
import type { KennelOption } from "./config-panels/KennelTagInput";

const SOURCE_TYPES = [
  "HTML_SCRAPER",
  "GOOGLE_CALENDAR",
  "GOOGLE_SHEETS",
  "ICAL_FEED",
  "HASHREGO",
  "MEETUP",
  "RSS_FEED",
  "STATIC_SCHEDULE",
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
  STATIC_SCHEDULE: "Auto-generates recurring events from schedule rules (no scraping)",
  JSON_API: "JSON API endpoint",
  MANUAL: "Manually entered events",
};

const STEPS = [
  { id: "url", label: "URL" },
  { id: "details", label: "Details" },
  { id: "configure", label: "Configure & Test" },
  { id: "review", label: "Review" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

interface SourceOnboardingWizardProps {
  allKennels: KennelOption[];
  geminiAvailable?: boolean;
}

function formatConfigKey(key: string): string {
  return key
    .replaceAll(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatConfigValue(value: unknown): string {
  if (Array.isArray(value))
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") return "{…}";
  return String(value);
}

/** Multi-phase guided wizard for onboarding a new data source (URL detection, config, preview). */
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
  const [isSuggestingName, setIsSuggestingName] = useState(false);
  const [nameSuggested, setNameSuggested] = useState(false);
  const [trustLevel, setTrustLevel] = useState(5);
  const [scrapeFreq, setScrapeFreq] = useState("daily");
  const [scrapeDays, setScrapeDays] = useState(90);
  const [selectedKennels, setSelectedKennels] = useState<string[]>([]);
  const [configObj, setConfigObj] = useState<Record<string, unknown> | null>(null);
  const [configJson, setConfigJson] = useState("");

  // Submit state
  const [isSubmitting, startSubmitting] = useTransition();

  const currentStepIndex = STEPS.findIndex((s) => s.id === currentStep);

  // Auto-suggest name when entering Details step with empty name
  useEffect(() => {
    if (currentStep !== "details" || name !== "" || !urlValue.trim()) return;
    let cancelled = false;
    setIsSuggestingName(true);
    suggestSourceName(urlValue, selectedType, configObj)
      .then((result) => {
        if (cancelled) return;
        if ("suggestedName" in result && name === "") {
          setName(result.suggestedName);
          setNameSuggested(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsSuggestingName(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentStep, name, urlValue, selectedType, configObj]);

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

      if (
        detected.type === "MEETUP" &&
        detected.groupUrlname &&
        configObj?.groupUrlname !== detected.groupUrlname
      ) {
        const next = { ...(configObj ?? {}), groupUrlname: detected.groupUrlname };
        setConfigObj(next);
        setConfigJson(JSON.stringify(next, null, 2));
      }
    } else {
      setDetectedType(null);
    }
  }

  function handleSubmit() {
    const fd = new FormData();
    fd.set("name", name);
    fd.set("url", urlValue);
    fd.set("type", selectedType);
    fd.set("trustLevel", String(trustLevel));
    fd.set("scrapeFreq", scrapeFreq);
    fd.set("scrapeDays", String(scrapeDays));
    fd.set("kennelIds", selectedKennels.join(","));
    if (configJson.trim()) fd.set("config", configJson.trim());

    startSubmitting(async () => {
      const result = await createSource(fd);
      if ("error" in result) {
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
    if (nextIndex < STEPS.length) setCurrentStep(STEPS[nextIndex].id);
  }

  function goBack() {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) setCurrentStep(STEPS[prevIndex].id);
  }

  function canAdvance(): boolean {
    if (currentStep === "url") return urlValue.trim().length > 0;
    if (currentStep === "details") return name.trim().length > 0;
    return true;
  }

  // Wider card for the split-panel configure step
  const cardMaxWidth = currentStep === "configure" ? "max-w-5xl" : "max-w-3xl";

  return (
    <div className={`mx-auto ${cardMaxWidth} space-y-6`}>
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
                    if (i <= currentStepIndex) setCurrentStep(step.id);
                  }}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isCompleted
                        ? "cursor-pointer bg-primary/10 text-primary hover:bg-primary/20"
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
                    {isCompleted ? "✓" : i + 1}
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
                <div className="relative">
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameSuggested(false);
                    }}
                    placeholder="e.g. HashNYC Website, Boston Hash Calendar"
                    autoFocus
                    disabled={isSuggestingName}
                  />
                  {isSuggestingName && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground animate-pulse">
                      Suggesting…
                    </span>
                  )}
                </div>
                {nameSuggested && (
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    ✨ Name suggested from source metadata. Edit to override.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  A human-readable name for this source.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="trustLevel">Trust Level (1–10)</Label>
                  <Input
                    id="trustLevel"
                    type="number"
                    min={1}
                    max={10}
                    value={trustLevel}
                    onChange={(e) =>
                      setTrustLevel(Number.parseInt(e.target.value) || 5)
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Higher = preferred when merging duplicate events. Use 5
                    for most single-kennel sources; 8–10 for official kennel
                    websites.
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
                  onChange={(e) =>
                    setScrapeDays(Number.parseInt(e.target.value) || 90)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  How far back to look when scraping. Default: 90 days.
                </p>
              </div>
            </CardContent>
          </>
        )}

        {/* Step 3: Configure & Test */}
        {currentStep === "configure" && (
          <>
            <CardHeader>
              <CardTitle>Configure &amp; Test</CardTitle>
              <CardDescription>
                Set up the adapter config, run a live test to verify results,
                and link kennels — all in one step.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ConfigureAndTest
                url={urlValue}
                type={selectedType}
                config={configObj}
                configJson={configJson}
                selectedKennels={selectedKennels}
                allKennels={allKennels}
                geminiAvailable={geminiAvailable}
                onConfigChange={(c, j) => {
                  setConfigObj(c);
                  setConfigJson(j);
                }}
                onKennelsChange={setSelectedKennels}
              />
            </CardContent>
          </>
        )}

        {/* Step 4: Review & Create */}
        {currentStep === "review" && (
          <>
            <CardHeader>
              <CardTitle>Review &amp; Create</CardTitle>
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
                    <p>
                      {name || (
                        <span className="text-destructive">Not set</span>
                      )}
                    </p>
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
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {urlValue || (
                      <span className="text-destructive font-sans">
                        Not set
                      </span>
                    )}
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      Trust Level
                    </span>
                    <p>{trustLevel}/10</p>
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

                {/* Friendly config display */}
                {configObj && Object.keys(configObj).length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      Config
                    </span>
                    <dl className="mt-1 space-y-0.5">
                      {Object.entries(configObj).map(([key, value]) => (
                        <div key={key} className="flex gap-2 text-xs">
                          <dt className="shrink-0 text-muted-foreground">
                            {formatConfigKey(key)}:
                          </dt>
                          <dd className="font-medium">
                            {formatConfigValue(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                <div>
                  <span className="text-xs font-medium text-muted-foreground">
                    Linked Kennels ({selectedKennels.length})
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {selectedKennels.length > 0 ? (
                      selectedKennels.map((id) => {
                        const kennel = allKennels.find((k) => k.id === id);
                        return (
                          <Badge
                            key={id}
                            variant="secondary"
                            className="text-xs"
                          >
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
              </div>

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
                disabled={isSubmitting || !name.trim() || !urlValue.trim()}
                onClick={handleSubmit}
              >
                {isSubmitting ? "Creating…" : "Create Source"}
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
