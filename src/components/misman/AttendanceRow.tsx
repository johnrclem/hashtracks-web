"use client";

import { Pencil, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AttendanceRecord } from "./AttendanceForm";

const REFERRAL_OPTIONS = [
  { value: "WORD_OF_MOUTH", label: "Word of Mouth" },
  { value: "SOCIAL_MEDIA", label: "Social Media" },
  { value: "REDDIT", label: "Reddit" },
  { value: "MEETUP", label: "Meetup" },
  { value: "GOOGLE_SEARCH", label: "Google Search" },
  { value: "OTHER", label: "Other" },
];

export interface AttendanceUpdateData {
  paid?: boolean;
  haredThisTrail?: boolean;
  isVirgin?: boolean;
  isVisitor?: boolean;
  visitorLocation?: string;
  referralSource?: string;
  referralOther?: string;
}

interface AttendanceRowProps {
  record: AttendanceRecord;
  onUpdate: (data: AttendanceUpdateData) => void;
  onRemove: () => void;
  onEdit: () => void;
  disabled?: boolean;
}

export function AttendanceRow({
  record,
  onUpdate,
  onRemove,
  onEdit,
  disabled,
}: AttendanceRowProps) {
  const displayName = record.hashName || record.nerdName || "Unknown";
  const isExpanded = record.isVirgin || record.isVisitor;

  return (
    <div className={`rounded-lg border p-3 space-y-2${isExpanded ? (record.isVisitor ? " border-l-2 border-l-blue-400" : " border-l-2 border-l-pink-400") : ""}`}>
      {/* Main row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 w-full sm:w-auto sm:flex-1 sm:min-w-0">
          <span className="text-left text-sm font-medium truncate">
            {displayName}
            {record.hashName && record.nerdName && (
              <span className="ml-1 text-muted-foreground font-normal">
                ({record.nerdName})
              </span>
            )}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onEdit}
            disabled={disabled}
            title="Edit hasher"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {record.hasEdits && (
            <span title="This record has been edited" className="text-muted-foreground">
              <History className="h-3 w-3" />
            </span>
          )}
        </div>

        {/* Quick toggles */}
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1 cursor-pointer" title="Paid">
            <Switch
              checked={record.paid}
              onCheckedChange={(v) => onUpdate({ paid: v })}
              disabled={disabled}
              className="scale-75 data-[state=checked]:bg-green-500"
              aria-label={`Mark ${displayName} as paid`}
            />
            <span className={record.paid ? "text-green-600 font-medium" : "text-muted-foreground"}>
              $
            </span>
          </label>

          <label className="flex items-center gap-1 cursor-pointer" title="Hare">
            <Switch
              checked={record.haredThisTrail}
              onCheckedChange={(v) => onUpdate({ haredThisTrail: v })}
              disabled={disabled}
              className="scale-75 data-[state=checked]:bg-orange-500"
              aria-label={`Mark ${displayName} as hare`}
            />
            <span className={record.haredThisTrail ? "text-orange-600 font-medium" : "text-muted-foreground"}>
              H
            </span>
          </label>

          <label className="flex items-center gap-1 cursor-pointer" title="Virgin">
            <Switch
              checked={record.isVirgin}
              onCheckedChange={(v) => onUpdate({ isVirgin: v })}
              disabled={disabled}
              className="scale-75 data-[state=checked]:bg-pink-500"
              aria-label={`Mark ${displayName} as virgin`}
            />
            <span className={record.isVirgin ? "text-pink-600 font-medium" : "text-muted-foreground"}>
              V
            </span>
          </label>

          <label className="flex items-center gap-1 cursor-pointer" title="Visitor">
            <Switch
              checked={record.isVisitor}
              onCheckedChange={(v) => onUpdate({ isVisitor: v })}
              disabled={disabled}
              className="scale-75 data-[state=checked]:bg-blue-500"
              aria-label={`Mark ${displayName} as visitor`}
            />
            <span className={record.isVisitor ? "text-blue-600 font-medium" : "text-muted-foreground"}>
              Vis
            </span>
          </label>
        </div>

        <Button
          size="sm"
          variant="ghost"
          className="text-destructive h-7 w-7 p-0"
          onClick={onRemove}
          disabled={disabled}
          title="Remove"
        >
          &times;
        </Button>
      </div>

      {/* Expanded visitor/referral fields */}
      {isExpanded && (
        <div className="pl-2 space-y-2 text-sm border-l-2 ml-1">
          {record.isVisitor && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground whitespace-nowrap">From:</span>
              <Input
                defaultValue={record.visitorLocation ?? ""}
                placeholder="City / kennel"
                className="h-7 text-sm"
                onBlur={(e) =>
                  onUpdate({ visitorLocation: e.target.value })
                }
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground whitespace-nowrap">How found:</span>
            <Select
              value={record.referralSource ?? ""}
              onValueChange={(v) => onUpdate({ referralSource: v })}
            >
              <SelectTrigger className="h-7 text-sm">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {REFERRAL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {record.referralSource === "OTHER" && (
            <Input
              defaultValue={record.referralOther ?? ""}
              placeholder="How did they find us?"
              className="h-7 text-sm"
              onBlur={(e) => onUpdate({ referralOther: e.target.value })}
            />
          )}
        </div>
      )}
    </div>
  );
}
