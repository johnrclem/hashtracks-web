"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { createSource, updateSource } from "@/app/admin/sources/actions";
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

const SOURCE_TYPES = [
  "HTML_SCRAPER",
  "GOOGLE_CALENDAR",
  "GOOGLE_SHEETS",
  "ICAL_FEED",
  "HASHREGO",
  "RSS_FEED",
  "JSON_API",
  "MANUAL",
] as const;

/** Types that use the config JSON field for adapter-specific settings */
const CONFIG_TYPES = new Set([
  "GOOGLE_CALENDAR",
  "GOOGLE_SHEETS",
  "ICAL_FEED",
  "HASHREGO",
]);

/** Types that get a dedicated config panel (vs raw JSON) */
const PANEL_TYPES = new Set(["GOOGLE_CALENDAR", "ICAL_FEED"]);

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

export function SourceForm({ source, allKennels, trigger }: SourceFormProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selectedKennels, setSelectedKennels] = useState<string[]>(
    source?.linkedKennelIds ?? [],
  );
  const [selectedType, setSelectedType] = useState(
    source?.type ?? "HTML_SCRAPER",
  );

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

  const panelType =
    selectedType === "ICAL_FEED" ||
    (selectedType === "HTML_SCRAPER" && hasICalConfigShape(configObj))
      ? "ical"
      : selectedType === "GOOGLE_CALENDAR"
        ? "calendar"
        : null;

  function toggleKennel(kennelId: string) {
    setSelectedKennels((prev) =>
      prev.includes(kennelId)
        ? prev.filter((id) => id !== kennelId)
        : [...prev, kennelId],
    );
  }

  /** Sync structured config object → raw JSON string */
  function handleConfigChange(newConfig: CalendarConfig | ICalConfig) {
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
      } else if (result.data) {
        setPreviewData(result.data);
        setPreviewError(null);
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
        setOpen(false);
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
      setOpen(v);
      if (!v) {
        setPreviewData(null);
        setPreviewError(null);
      }
    }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className={`max-h-[90vh] overflow-y-auto ${dialogWidth}`}
      >
        <DialogHeader>
          <DialogTitle>
            {source ? "Edit Source" : "Add Source"}
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
              defaultValue={source?.url ?? ""}
              placeholder="https://hashnyc.com"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="type">Type *</Label>
              <Select
                name="type"
                value={selectedType}
                onValueChange={(val) => {
                  setSelectedType(val);
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
            {previewData && <PreviewResults data={previewData} />}
          </div>

          <div className="space-y-2">
            <Label>Linked Kennels</Label>
            <TooltipProvider>
              <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto rounded-md border p-2">
                {allKennels.map((kennel) => (
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
            <p className="text-xs text-muted-foreground">
              Click to toggle. {selectedKennels.length} selected.
            </p>
          </div>

          <input
            type="hidden"
            name="kennelIds"
            value={selectedKennels.join(",")}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
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
