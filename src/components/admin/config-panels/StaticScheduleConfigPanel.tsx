"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KennelTagInput, type KennelOption } from "./KennelTagInput";

/** Form-level lunar config block. */
export interface LunarConfigForm {
  phase?: "full" | "new";
  timezone?: string;
  anchorWeekday?: "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";
  anchorRule?: "nearest" | "on-or-after" | "on-or-before";
}

/**
 * Form-level config shape for the STATIC_SCHEDULE source type.
 *
 * Modes are mutually exclusive (XOR enforced server-side):
 *   - RRULE mode: `rrule` is set, `lunar` is omitted.
 *   - Lunar mode: `lunar` is set, `rrule` is omitted.
 */
export interface StaticScheduleConfig {
  kennelTag?: string;
  rrule?: string;
  lunar?: LunarConfigForm;
  anchorDate?: string;
  startTime?: string;
  defaultTitle?: string;
  titleTemplate?: string;
  defaultLocation?: string;
  defaultDescription?: string;
}

interface StaticScheduleConfigPanelProps {
  readonly config: StaticScheduleConfig | null;
  readonly onChange: (config: StaticScheduleConfig) => void;
  readonly allKennels?: KennelOption[];
}

const WEEKDAY_OPTIONS: { value: NonNullable<LunarConfigForm["anchorWeekday"]>; label: string }[] = [
  { value: "SU", label: "Sunday" },
  { value: "MO", label: "Monday" },
  { value: "TU", label: "Tuesday" },
  { value: "WE", label: "Wednesday" },
  { value: "TH", label: "Thursday" },
  { value: "FR", label: "Friday" },
  { value: "SA", label: "Saturday" },
];

// Radix `Select` requires non-empty values; these sentinels stand in for an
// "unset" anchor pair without colliding with real anchorWeekday/anchorRule values.
const ANCHOR_NONE = "__none__";

interface StashState {
  rrule: { rrule?: string; anchorDate?: string };
  lunar: LunarConfigForm | undefined;
}

/**
 * Pure derive-state-from-props rule for the mode-switch stash.
 *
 * Keeps the most recent non-undefined value of each mode's draft. Switching
 * modes clears the inactive mode's fields locally; the stash retains the
 * value so switching back restores it. Commit-safe (React rolls back useState
 * updates from aborted renders).
 *
 * Exported for unit testing — see `StaticScheduleConfigPanel.test.ts`.
 */
export function syncStashFromConfig(
  prev: StashState,
  current: { rrule?: string; anchorDate?: string; lunar?: LunarConfigForm },
): StashState {
  // Source of truth is the *active* mode: when `current.lunar` is set we're
  // in lunar mode and the parent has locally cleared rrule/anchorDate; keep
  // the previous draft for both. When lunar is unset we're in rrule mode —
  // capture rrule AND anchorDate together so an anchorDate edit isn't lost
  // when rrule happens to be empty (CodeRabbit review finding). The
  // `hasRruleField` guard preserves the previous draft when current is fully
  // empty (e.g. initial null config) instead of wiping it.
  const inRruleMode = current.lunar === undefined;
  const hasRruleField = current.rrule !== undefined || current.anchorDate !== undefined;
  return {
    rrule: inRruleMode && hasRruleField
      ? { rrule: current.rrule, anchorDate: current.anchorDate }
      : prev.rrule,
    lunar: current.lunar ?? prev.lunar,
  };
}

/**
 * Admin panel for editing STATIC_SCHEDULE source config.
 *
 * Top-level mode selector swaps the recurrence inputs between RRULE (calendar
 * recurrence) and Lunar (full/new moon, optional weekday anchor). The XOR
 * contract is enforced server-side; the UI just hides the irrelevant inputs.
 */
export function StaticScheduleConfigPanel({
  config,
  onChange,
  allKennels,
}: StaticScheduleConfigPanelProps) {
  const current = config ?? {};
  // Mode is derived from which field is set. Default to "rrule" for new sources
  // (rrule is the more common case; lunar is opt-in for ~30 of the 200+ sources).
  const mode: "rrule" | "lunar" = current.lunar ? "lunar" : "rrule";
  const lunar = current.lunar ?? {};

  // Per-mode drafts in commit-safe React state (not refs — refs mutated in
  // render are not rollback-safe under React concurrent rendering, see Codex
  // pass-9). Stash preserves the inactive mode's draft so switching back
  // restores it instead of starting from blank.
  const [stash, setStash] = useState<StashState>(() => ({
    rrule: { rrule: config?.rrule, anchorDate: config?.anchorDate },
    lunar: config?.lunar,
  }));
  // "Derive state from props" pattern keyed on the *prop reference* — NOT on
  // `current` (which is `config ?? {}` and allocates a fresh object every
  // render when config is null, which would infinite-loop the setState below).
  // Codex pass-11 caught this regression.
  const [lastConfig, setLastConfig] = useState(config);
  if (config !== lastConfig) {
    setLastConfig(config);
    setStash((prev) => syncStashFromConfig(prev, config ?? {}));
  }

  const setMode = (next: "rrule" | "lunar") => {
    if (next === mode) return;
    if (next === "lunar") {
      const restoredLunar = stash.lunar ?? { phase: "full", timezone: "" };
      onChange({
        ...current,
        rrule: undefined,
        anchorDate: undefined,
        lunar: restoredLunar,
      });
    } else {
      onChange({
        ...current,
        lunar: undefined,
        rrule: stash.rrule.rrule,
        anchorDate: stash.rrule.anchorDate,
      });
    }
  };

  const updateLunar = (patch: Partial<LunarConfigForm>) => {
    onChange({ ...current, lunar: { ...lunar, ...patch } });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="ss-kennel-tag">Kennel Tag *</Label>
        <KennelTagInput
          id="ss-kennel-tag"
          value={current.kennelTag ?? ""}
          onChange={(v) =>
            onChange({ ...current, kennelTag: v || undefined })
          }
          allKennels={allKennels}
          placeholder="e.g. Rumson"
        />
        <p className="text-xs text-muted-foreground">
          All generated events are assigned to this kennel shortName.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ss-mode">Recurrence Mode *</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as "rrule" | "lunar")}>
          <SelectTrigger id="ss-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rrule">RRULE (calendar — weekly, monthly, etc.)</SelectItem>
            <SelectItem value="lunar">Lunar phase (full or new moon)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Use Lunar mode for kennels that run on the full or new moon (e.g. FMH3,
          DCFMH3). Otherwise use RRULE.
        </p>
      </div>

      {mode === "rrule" && (
        <div className="space-y-2">
          <Label htmlFor="ss-rrule">Recurrence Rule (RRULE) *</Label>
          <Input
            id="ss-rrule"
            value={current.rrule ?? ""}
            onChange={(e) =>
              onChange({ ...current, rrule: e.target.value || undefined })
            }
            placeholder="FREQ=WEEKLY;BYDAY=SA"
          />
          <p className="text-xs text-muted-foreground">
            RFC 5545 RRULE string. Examples:{" "}
            <code className="rounded bg-muted px-1">FREQ=WEEKLY;BYDAY=SA</code>{" "}
            (every Saturday),{" "}
            <code className="rounded bg-muted px-1">FREQ=WEEKLY;INTERVAL=2;BYDAY=SA</code>{" "}
            (biweekly),{" "}
            <code className="rounded bg-muted px-1">FREQ=MONTHLY;BYDAY=2SA</code>{" "}
            (2nd Saturday of month).
          </p>
        </div>
      )}

      {mode === "lunar" && (
        <div className="space-y-4 rounded-md border bg-muted/30 p-3">
          <div className="space-y-2">
            <Label htmlFor="ss-lunar-phase">Lunar Phase *</Label>
            <Select
              value={lunar.phase ?? "full"}
              onValueChange={(v) => updateLunar({ phase: v as "full" | "new" })}
            >
              <SelectTrigger id="ss-lunar-phase">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full moon</SelectItem>
                <SelectItem value="new">New moon</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ss-lunar-tz">Kennel Timezone *</Label>
            <Input
              id="ss-lunar-tz"
              value={lunar.timezone ?? ""}
              onChange={(e) => updateLunar({ timezone: e.target.value })}
              placeholder="America/Los_Angeles"
            />
            <p className="text-xs text-muted-foreground">
              IANA timezone the kennel operates in. The phase instant is
              converted to the calendar date in this zone — e.g. a full moon at
              03:00 UTC is the previous day in Honolulu but the same day in London.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ss-lunar-anchor-weekday">Anchor Weekday</Label>
              <Select
                value={lunar.anchorWeekday ?? ANCHOR_NONE}
                onValueChange={(v) =>
                  updateLunar({
                    anchorWeekday:
                      v === ANCHOR_NONE
                        ? undefined
                        : (v as NonNullable<LunarConfigForm["anchorWeekday"]>),
                    // Anchor weekday + rule are an XOR pair — clearing one
                    // clears the other; setting one defaults to "nearest".
                    anchorRule: v === ANCHOR_NONE ? undefined : (lunar.anchorRule ?? "nearest"),
                  })
                }
              >
                <SelectTrigger id="ss-lunar-anchor-weekday">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANCHOR_NONE}>None (exact phase date)</SelectItem>
                  {WEEKDAY_OPTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ss-lunar-anchor-rule">Anchor Rule</Label>
              <Select
                // Radix Select requires non-empty value; sentinel for the
                // disabled-Select state when no anchor weekday is chosen.
                value={lunar.anchorRule ?? ANCHOR_NONE}
                onValueChange={(v) =>
                  updateLunar({
                    anchorRule: v as NonNullable<LunarConfigForm["anchorRule"]>,
                  })
                }
                disabled={!lunar.anchorWeekday}
              >
                <SelectTrigger id="ss-lunar-anchor-rule">
                  <SelectValue placeholder={lunar.anchorWeekday ? "Pick a rule" : "Anchor disabled"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nearest">Nearest weekday</SelectItem>
                  <SelectItem value="on-or-after">On or after phase</SelectItem>
                  <SelectItem value="on-or-before">On or before phase</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Anchor mode snaps the event to the nearest matching weekday relative
            to the astronomical phase — useful for kennels like DCFMH3
            (&quot;Friday/Saturday near full moon&quot;). Leave anchor weekday set
            to <em>None</em> to land directly on the phase date.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="ss-anchor-date">RRULE Anchor Date</Label>
        <Input
          id="ss-anchor-date"
          value={current.anchorDate ?? ""}
          onChange={(e) =>
            onChange({ ...current, anchorDate: e.target.value || undefined })
          }
          placeholder="2026-01-03"
          disabled={mode === "lunar"}
        />
        <p className="text-xs text-muted-foreground">
          YYYY-MM-DD of a known past occurrence. Required for RRULE INTERVAL &gt; 1
          to keep generated dates stable between scrapes. Ignored in Lunar mode.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ss-start-time">Start Time</Label>
        <Input
          id="ss-start-time"
          value={current.startTime ?? ""}
          onChange={(e) =>
            onChange({ ...current, startTime: e.target.value || undefined })
          }
          placeholder="10:17"
        />
        <p className="text-xs text-muted-foreground">
          24-hour format, e.g. &quot;10:17&quot;, &quot;19:00&quot;.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ss-title">Default Title</Label>
        <Input
          id="ss-title"
          value={current.defaultTitle ?? ""}
          onChange={(e) =>
            onChange({ ...current, defaultTitle: e.target.value || undefined })
          }
          placeholder="e.g. Rumson H3 Weekly Run"
        />
        <p className="text-xs text-muted-foreground">
          Used when Title Template is empty. Same string on every generated event.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ss-title-template">Title Template</Label>
        <Input
          id="ss-title-template"
          value={current.titleTemplate ?? ""}
          onChange={(e) =>
            onChange({ ...current, titleTemplate: e.target.value || undefined })
          }
          placeholder="e.g. CVH3 — {date} Hash"
        />
        <p className="text-xs text-muted-foreground">
          Optional. When set, overrides Default Title. Tokens:{" "}
          <code className="rounded bg-muted px-1">{"{dayName}"}</code>,{" "}
          <code className="rounded bg-muted px-1">{"{monthName}"}</code>,{" "}
          <code className="rounded bg-muted px-1">{"{date}"}</code>,{" "}
          <code className="rounded bg-muted px-1">{"{iso}"}</code>. Unknown
          tokens render literal.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ss-location">Default Location</Label>
        <Input
          id="ss-location"
          value={current.defaultLocation ?? ""}
          onChange={(e) =>
            onChange({ ...current, defaultLocation: e.target.value || undefined })
          }
          placeholder="e.g. Rumson, NJ"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ss-description">Default Description</Label>
        <Input
          id="ss-description"
          value={current.defaultDescription ?? ""}
          onChange={(e) =>
            onChange({
              ...current,
              defaultDescription: e.target.value || undefined,
            })
          }
          placeholder="e.g. Check Facebook for start location and hare details."
        />
      </div>
    </div>
  );
}
