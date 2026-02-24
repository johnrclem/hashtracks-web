"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { createSource, updateSource, createQuickKennel } from "@/app/admin/sources/actions";
import { detectSourceType } from "@/lib/source-detect";
import {
  previewSourceConfig,
  type PreviewData,
} from "@/app/admin/sources/preview-action";
import { PreviewResults } from "./PreviewResults";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  StaticScheduleConfigPanel,
  type StaticScheduleConfig,
} from "./config-panels/StaticScheduleConfigPanel";

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

/** Types that use the config JSON field for adapter-specific settings */
const CONFIG_TYPES = new Set([
  "GOOGLE_CALENDAR",
  "GOOGLE_SHEETS",
  "ICAL_FEED",
  "HASHREGO",
  "MEETUP",
  "RSS_FEED",
  "STATIC_SCHEDULE",
]);

/** Types that get a dedicated config panel (vs raw JSON) */
const PANEL_TYPES = new Set(["GOOGLE_CALENDAR", "ICAL_FEED", "HASHREGO", "GOOGLE_SHEETS", "MEETUP", "RSS_FEED", "STATIC_SCHEDULE"]);

type SourceData = {
  id: string;
  name: string;
  url: string;
  type: string;
  trustLevel: number;
  scrapeFreq: string;
  scrapeDays: number;
  config: unknown;
  linkedKennelIds: string[];
};

interface SourceFormProps {
  source?: SourceData;
  allKennels: {
    id: string;
    shortName: string;
    fullName: string;
    region: string;
  }[];
  /** Open UNMATCHED_TAGS alert tags for this source (edit mode only) */
  openAlertTags?: string[];
  /** Whether GEMINI_API_KEY is configured — enables "Enhance with AI" button */
  geminiAvailable?: boolean;
  trigger: React.ReactNode;
}

/** Check if an existing config object has iCal-style shape (kennelPatterns/skipPatterns) */
function hasICalConfigShape(config: unknown): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const obj = config as Record<string, unknown>;
  return (
    "kennelPatterns" in obj ||
    "defaultKennelTag" in obj ||
    "skipPatterns" in obj
  );
}

export function SourceForm({ source, allKennels, openAlertTags, geminiAvailable, trigger }: SourceFormProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selectedKennels, setSelectedKennels] = useState<string[]>(
    source?.linkedKennelIds ?? [],
  );
  const [selectedType, setSelectedType] = useState(
    source?.type ?? "HTML_SCRAPER",
  );
  const [urlValue, setUrlValue] = useState(source?.url ?? "");
  /** True once the admin has explicitly chosen a type — prevents URL-detect override */
  const typeManuallySet = useRef(!!source);
  /** Chip text shown below URL field after auto-detect fires (new source only) */
  const [detectedHint, setDetectedHint] = useState<string | null>(null);

  // Config can be edited via structured panel or raw JSON
  const [configObj, setConfigObj] = useState<Record<string, unknown> | null>(
    () => {
      if (!source?.config || typeof source.config !== "object" || Array.isArray(source.config))
        return null;
      return source.config as Record<string, unknown>;
    },
  );
  const [configJson, setConfigJson] = useState(() => {
    if (!source?.config) return "";
    try {
      return JSON.stringify(source.config, null, 2);
    } catch {
      return "";
    }
  });
  const [showRawJson, setShowRawJson] = useState(false);
  const [isPreviewing, startPreview] = useTransition();
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** Sample event titles per unmatched tag — computed from preview results for AI enhance */
  const [sampleTitlesByTag, setSampleTitlesByTag] = useState<Record<string, string[]>>({});
  /** Kennels created inline via the quick-create dialog — merged with allKennels for display */
  const [extraKennels, setExtraKennels] = useState<typeof allKennels>([]);
  /** State for the quick-create kennel mini-dialog */
  const [quickKennelOpen, setQuickKennelOpen] = useState(false);
  const [quickKennelShortName, setQuickKennelShortName] = useState("");
  const [quickKennelFullName, setQuickKennelFullName] = useState("");
  const [quickKennelRegion, setQuickKennelRegion] = useState("");
  const [isCreatingKennel, startCreatingKennel] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  const showConfigEditor = CONFIG_TYPES.has(selectedType);

  // Determine which panel to show:
  // - GOOGLE_CALENDAR → CalendarConfigPanel
  // - ICAL_FEED → ICalConfigPanel
  // - HTML_SCRAPER with iCal-style config (SFH3) → ICalConfigPanel
  // - Others with config → raw JSON only
  const hasPanel =
    PANEL_TYPES.has(selectedType) ||
    (selectedType === "HTML_SCRAPER" && hasICalConfigShape(configObj));

  function getPanelType(
    type: string,
    config: Record<string, unknown> | null,
  ): "ical" | "calendar" | "hashrego" | "sheets" | "meetup" | "rss" | "static-schedule" | null {
    if (type === "ICAL_FEED" || (type === "HTML_SCRAPER" && hasICalConfigShape(config))) return "ical";
    if (type === "GOOGLE_CALENDAR") return "calendar";
    if (type === "HASHREGO") return "hashrego";
    if (type === "GOOGLE_SHEETS") return "sheets";
    if (type === "MEETUP") return "meetup";
    if (type === "RSS_FEED") return "rss";
    if (type === "STATIC_SCHEDULE") return "static-schedule";
    return null;
  }

  const panelType = getPanelType(selectedType, configObj);

  function toggleKennel(kennelId: string) {
    setSelectedKennels((prev) =>
      prev.includes(kennelId)
        ? prev.filter((id) => id !== kennelId)
        : [...prev, kennelId],
    );
  }

  /** Sync structured config object → raw JSON string */
  function handleConfigChange(newConfig: CalendarConfig | ICalConfig | HashRegoConfig | SheetsConfig | MeetupConfig | RssConfig | StaticScheduleConfig) {
    // Clean undefined values
    const entries = Object.entries(newConfig).filter(
      ([, v]) => v !== undefined,
    );
    const cleaned = Object.fromEntries(entries) as Record<string, unknown>;
    const hasContent = entries.length > 0;
    setConfigObj(hasContent ? cleaned : null);
    setConfigJson(hasContent ? JSON.stringify(cleaned, null, 2) : "");
  }

  /** Sync raw JSON string → structured config object */
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

  function closeDialog() {
    setOpen(false);
    setPreviewData(null);
    setPreviewError(null);
    setSampleTitlesByTag({});
    setExtraKennels([]);
    setQuickKennelOpen(false);
  }

  const allKennelsWithExtra = [...allKennels, ...extraKennels];

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
        setExtraKennels((prev) => [...prev, { id: result.id, shortName: result.shortName, fullName: result.fullName, region: result.region }]);
        setSelectedKennels((prev) => [...prev, result.id]);
        resetQuickKennelForm();
        toast.success(`Kennel "${result.shortName}" created and linked`);
      }
    });
  }

  function handleUrlBlur() {
    if (typeManuallySet.current) return; // admin already chose a type — don't override
    const detected = detectSourceType(urlValue);
    if (!detected) return;

    setSelectedType(detected.type);
    setDetectedHint(detected.type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()));

    // For GOOGLE_CALENDAR: replace url field with extracted calendarId
    if (detected.extractedUrl) {
      setUrlValue(detected.extractedUrl);
    }

    // For GOOGLE_SHEETS: auto-populate sheetId into config
    if (detected.sheetId && configObj?.sheetId !== detected.sheetId) {
      const next = { ...(configObj ?? {}), sheetId: detected.sheetId };
      setConfigObj(next);
      setConfigJson(JSON.stringify(next, null, 2));
    }

    // For MEETUP: auto-populate groupUrlname into config
    if (detected.type === "MEETUP" && detected.groupUrlname && configObj?.groupUrlname !== detected.groupUrlname) {
      const next = { ...(configObj ?? {}), groupUrlname: detected.groupUrlname };
      setConfigObj(next);
      setConfigJson(JSON.stringify(next, null, 2));
    }
  }

  function handlePreview() {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    // Ensure config JSON is included
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
        // Compute sample titles per unmatched tag for AI enhance
        const titles = result.data.events.reduce<Record<string, string[]>>((acc, e) => {
          if (!e.resolved && e.title) {
            (acc[e.kennelTag] ??= []).push(e.title);
          }
          return acc;
        }, {});
        setSampleTitlesByTag(titles);
      }
    });
  }

  function handleSubmit(formData: FormData) {
    formData.set("kennelIds", selectedKennels.join(","));
    // Pass config JSON string (server action will parse it)
    if (configJson.trim()) {
      formData.set("config", configJson.trim());
    }

    startTransition(async () => {
      const result = source
        ? await updateSource(source.id, formData)
        : await createSource(formData);

      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(source ? "Source updated" : "Source created");
        closeDialog();
        if (!source) {
          setSelectedKennels([]);
          setConfigJson("");
          setConfigObj(null);
        }
        router.refresh();
      }
    });
  }

  // Widen dialog when config panel is visible
  const dialogWidth = hasPanel || showConfigEditor
    ? "sm:max-w-2xl"
    : "sm:max-w-lg";

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (v) setOpen(true);
      else closeDialog();
    }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className={`max-h-[90vh] overflow-y-auto ${dialogWidth}`}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {source ? "Edit Source" : "Add Source"}
            {openAlertTags && openAlertTags.length > 0 && (
              <Badge variant="outline" className="border-amber-300 text-amber-700 text-xs font-normal">
                {openAlertTags.length} unmatched tag{openAlertTags.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <form ref={formRef} action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={source?.name ?? ""}
              placeholder="HashNYC Website"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">URL *</Label>
            <Input
              id="url"
              name="url"
              required
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              onBlur={handleUrlBlur}
              placeholder="https://hashnyc.com"
            />
            {detectedHint && (
              <p className="text-xs text-blue-600">
                Detected: {detectedHint} — type and config auto-filled
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="type">Type *</Label>
              <Select
                name="type"
                value={selectedType}
                onValueChange={(val) => {
                  setSelectedType(val);
                  typeManuallySet.current = true;
                  setDetectedHint(null);
                  // Clear config when switching to incompatible type
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="trustLevel">Trust Level (1-10)</Label>
              <Input
                id="trustLevel"
                name="trustLevel"
                type="number"
                min="1"
                max="10"
                defaultValue={source?.trustLevel ?? 5}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="scrapeFreq">Scrape Frequency</Label>
            <Select
              name="scrapeFreq"
              defaultValue={source?.scrapeFreq ?? "daily"}
            >
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
            <p className="text-xs text-muted-foreground">
              Hourly and Every 6 Hours require Vercel Pro plan. Hobby plans run
              cron once daily.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="scrapeDays">Scrape Lookback (days)</Label>
            <Input
              id="scrapeDays"
              name="scrapeDays"
              type="number"
              min="1"
              max="365"
              defaultValue={source?.scrapeDays ?? 90}
            />
            <p className="text-xs text-muted-foreground">
              How far back to look when scraping events. Default: 90 days.
            </p>
          </div>

          {/* Structured config panels */}
          {panelType === "calendar" && (
            <div className="space-y-2 rounded-md border p-4">
              <Label className="text-sm font-semibold">
                Calendar Configuration
              </Label>
              <CalendarConfigPanel
                config={configObj as CalendarConfig | null}
                onChange={handleConfigChange}
                unmatchedTags={[
                  ...(previewData?.unmatchedTags ?? []),
                  ...(openAlertTags ?? []),
                ]}
                sampleTitlesByTag={sampleTitlesByTag}
                geminiAvailable={geminiAvailable}
              />
            </div>
          )}

          {panelType === "ical" && (
            <div className="space-y-2 rounded-md border p-4">
              <Label className="text-sm font-semibold">
                {selectedType === "HTML_SCRAPER"
                  ? "Scraper Configuration"
                  : "iCal Feed Configuration"}
              </Label>
              <ICalConfigPanel
                config={configObj as ICalConfig | null}
                onChange={handleConfigChange}
                unmatchedTags={[
                  ...(previewData?.unmatchedTags ?? []),
                  ...(openAlertTags ?? []),
                ]}
                sampleTitlesByTag={sampleTitlesByTag}
                geminiAvailable={geminiAvailable}
              />
            </div>
          )}

          {panelType === "hashrego" && (
            <div className="space-y-2 rounded-md border p-4">
              <Label className="text-sm font-semibold">
                Hash Rego Configuration
              </Label>
              <HashRegoConfigPanel
                config={configObj as HashRegoConfig | null}
                onChange={handleConfigChange}
              />
            </div>
          )}

          {panelType === "sheets" && (
            <div className="space-y-2 rounded-md border p-4">
              <Label className="text-sm font-semibold">
                Google Sheets Configuration
              </Label>
              <SheetsConfigPanel
                config={configObj as SheetsConfig | null}
                onChange={handleConfigChange}
                sampleRows={previewData?.sampleRows}
                geminiAvailable={geminiAvailable}
              />
            </div>
          )}

          {panelType === "meetup" && (
            <div className="space-y-2 rounded-md border p-4">
              <Label className="text-sm font-semibold">
                Meetup Configuration
              </Label>
              <MeetupConfigPanel
                config={configObj as MeetupConfig | null}
                onChange={handleConfigChange}
              />
            </div>
          )}

          {panelType === "rss" && (
            <div className="space-y-2 rounded-md border p-4">
              <Label className="text-sm font-semibold">
                RSS Feed Configuration
              </Label>
              <RssConfigPanel
                config={configObj as RssConfig | null}
                onChange={handleConfigChange}
              />
            </div>
          )}

          {panelType === "static-schedule" && (
            <div className="space-y-2 rounded-md border p-4">
              <Label className="text-sm font-semibold">
                Static Schedule Configuration
              </Label>
              <StaticScheduleConfigPanel
                config={configObj as StaticScheduleConfig | null}
                onChange={handleConfigChange}
              />
            </div>
          )}

          {/* Raw JSON editor — collapsible when panel is active, always shown for types without panels */}
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

          {/* Test Config (Preview) */}
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPreviewing || isPending}
              onClick={handlePreview}
            >
              {isPreviewing ? "Testing..." : "Test Config"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Fetch events using the current URL and config without saving.
            </p>
            {previewError && (
              <p className="text-sm text-destructive">{previewError}</p>
            )}
            {previewData && (
              <PreviewResults
                data={previewData}
                allKennels={allKennelsWithExtra}
                onAliasCreated={handlePreview}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>Linked Kennels</Label>
            <TooltipProvider>
              <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto rounded-md border p-2">
                {allKennelsWithExtra.map((kennel) => (
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
                      {kennel.region ? ` — ${kennel.region}` : ""}
                    </TooltipContent>
                  </Tooltip>
                ))}
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
          </div>

          {/* Quick kennel creation mini-form */}
          {quickKennelOpen && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-medium">Create New Kennel</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="qk-shortName" className="text-xs">Short Name *</Label>
                  <Input
                    id="qk-shortName"
                    value={quickKennelShortName}
                    onChange={(e) => setQuickKennelShortName(e.target.value)}
                    placeholder="NYCH3"
                    className="h-7 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="qk-region" className="text-xs">Region *</Label>
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
                <Label htmlFor="qk-fullName" className="text-xs">Full Name *</Label>
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

          <input
            type="hidden"
            name="kennelIds"
            value={selectedKennels.join(",")}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => closeDialog()}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? "Saving..."
                : source
                  ? "Save Changes"
                  : "Create Source"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
