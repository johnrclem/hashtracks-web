"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createManualEvent, searchKennels } from "@/app/logbook/actions";
import { PARTICIPATION_LEVELS, participationLevelLabel, regionAbbrev, regionColorClasses } from "@/lib/format";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  useState,
  useEffect,
  useTransition,
  useRef,
  useCallback,
} from "react";
import { ChevronRight, Loader2 } from "lucide-react";

interface LogUnlistedRunDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

type KennelResult = {
  id: string;
  shortName: string;
  fullName: string;
  region: string;
};

const PRIMARY_LEVELS = ["RUN", "HARE", "WALK", "CIRCLE_ONLY"];
const MORE_LEVELS = PARTICIPATION_LEVELS.filter(
  (l) => !PRIMARY_LEVELS.includes(l),
);

function getTodayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function LogUnlistedRunDialog({
  open,
  onOpenChange,
}: LogUnlistedRunDialogProps) {
  const [kennelId, setKennelId] = useState<string | null>(null);
  const [kennelQuery, setKennelQuery] = useState("");
  const [kennelResults, setKennelResults] = useState<KennelResult[]>([]);
  const [showKennelDropdown, setShowKennelDropdown] = useState(false);
  const [date, setDate] = useState(getTodayString);
  const [participationLevel, setParticipationLevel] = useState("RUN");
  const [title, setTitle] = useState("");
  const [locationName, setLocationName] = useState("");
  const [notes, setNotes] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [showMoreLevels, setShowMoreLevels] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setKennelId(null);
      setKennelQuery("");
      setKennelResults([]);
      setShowKennelDropdown(false);
      setDate(getTodayString());
      setParticipationLevel("RUN");
      setTitle("");
      setLocationName("");
      setNotes("");
      setShowDetails(false);
      setShowMoreLevels(false);
      setError(null);
    }
  }, [open]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showKennelDropdown) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowKennelDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showKennelDropdown]);

  const onKennelQueryChange = useCallback((value: string) => {
    setKennelQuery(value);
    setKennelId(null);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length === 0) {
      setKennelResults([]);
      setShowKennelDropdown(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const result = await searchKennels(value);
      if (result.success) {
        setKennelResults(result.kennels);
        setShowKennelDropdown(result.kennels.length > 0);
      }
    }, 300);
  }, []);

  const selectKennel = useCallback((kennel: KennelResult) => {
    setKennelId(kennel.id);
    setKennelQuery(kennel.shortName);
    setShowKennelDropdown(false);
    setError(null);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!kennelId) {
      setError("Please select a kennel");
      return;
    }
    if (!date) {
      setError("Please select a date");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createManualEvent({
        kennelId,
        date,
        title: title || undefined,
        locationName: locationName || undefined,
        participationLevel,
        notes: notes || undefined,
      });
      if (result.success) {
        toast.success("Run logged!");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [
    kennelId,
    date,
    title,
    locationName,
    participationLevel,
    notes,
    onOpenChange,
    router,
  ]);

  const todayString = getTodayString();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>Log Unlisted Run</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Add a run that isn&apos;t on the hareline yet.
          </p>
        </DialogHeader>

        <div className="space-y-4 px-6 py-4">
          {/* Kennel search */}
          <div>
            <label htmlFor="kennel-search" className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Kennel <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <Input
                id="kennel-search"
                ref={inputRef}
                placeholder="Search kennels..."
                value={kennelQuery}
                onChange={(e) => onKennelQueryChange(e.target.value)}
                onFocus={() => {
                  if (kennelResults.length > 0 && !kennelId) {
                    setShowKennelDropdown(true);
                  }
                }}
                className="bg-muted text-sm"
              />
              {showKennelDropdown && kennelResults.length > 0 && (
                <div
                  ref={dropdownRef}
                  className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-[200px] overflow-y-auto"
                >
                  {kennelResults.map((kennel) => {
                    const abbrev = regionAbbrev(kennel.region);
                    const colorCls = regionColorClasses(kennel.region);
                    return (
                      <button
                        key={kennel.id}
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                        onClick={() => selectKennel(kennel)}
                      >
                        <span className="font-medium">{kennel.shortName}</span>
                        <span className="text-muted-foreground text-xs truncate flex-1">
                          {kennel.fullName}
                        </span>
                        {abbrev && (
                          <span
                            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none shrink-0 ${colorCls}`}
                          >
                            {abbrev}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Date */}
          <div>
            <label htmlFor="event-date" className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Date <span className="text-red-400">*</span>
            </label>
            <Input
              id="event-date"
              type="date"
              max={todayString}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setError(null);
              }}
              className="bg-muted text-sm"
            />
          </div>

          {/* Role / Participation Level */}
          <div>
            <label id="role-selector-label" className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Role
            </label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="role-selector-label">
              {PRIMARY_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setParticipationLevel(level)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    participationLevel === level
                      ? "bg-emerald-500 text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {participationLevelLabel(level)}
                </button>
              ))}
              {!showMoreLevels && (
                <button
                  type="button"
                  onClick={() => setShowMoreLevels(true)}
                  className="rounded-full px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors bg-muted/50"
                >
                  More...
                </button>
              )}
              {showMoreLevels &&
                MORE_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setParticipationLevel(level)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      participationLevel === level
                        ? "bg-emerald-500 text-white"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {participationLevelLabel(level)}
                  </button>
                ))}
            </div>
          </div>

          {/* Optional details toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight
                size={14}
                className={`transition-transform ${showDetails ? "rotate-90" : ""}`}
              />
              Add details (title, location, notes)
            </button>
            {showDetails && (
              <div className="mt-3 space-y-3">
                <Input
                  placeholder="e.g., St. Patrick's Day Trail"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="bg-muted text-sm"
                />
                <Input
                  placeholder="Start location"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  className="bg-muted text-sm"
                />
                <Textarea
                  placeholder="Trail notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="bg-muted text-sm min-h-[60px]"
                  rows={2}
                />
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t bg-muted/50 px-6 py-3">
          <a
            href="/kennels/request"
            className="text-xs text-blue-500 hover:text-blue-600 transition-colors"
          >
            Can&apos;t find your kennel? Request it
          </a>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !kennelId || !date}
            className="bg-emerald-500 text-white hover:bg-emerald-600 h-8 text-sm px-4"
          >
            {isPending ? (
              <>
                <Loader2 size={14} className="mr-1 animate-spin" />
                Saving...
              </>
            ) : (
              "Log Run"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
