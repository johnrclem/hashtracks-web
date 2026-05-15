"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { createKennel, updateKennel } from "@/app/admin/kennels/actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RegionCombobox, type RegionOption } from "./RegionCombobox";
import type { AdminKennelData } from "./kennel-data-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { generateAliases } from "@/lib/auto-aliases";
import { GeocodeButton } from "./GeocodeButton";
import { geocodeAction } from "@/app/admin/geocode-action";

type KennelData = AdminKennelData;

interface KennelFormProps {
  kennel?: KennelData;
  regions: RegionOption[];
  trigger: React.ReactNode;
}

// #1415: Layout for the Profile section — two two-up rows + one full-width row.
type ProfileFieldName = "gm" | "hareRaiser" | "founder" | "parentKennelCode" | "signatureEvent";
const PROFILE_FIELD_GROUPS: Array<Array<{ name: ProfileFieldName; label: string; placeholder: string }>> = [
  [
    { name: "gm", label: "GM", placeholder: "Titty Kitty" },
    { name: "hareRaiser", label: "Hare Raiser", placeholder: "Rock Hard" },
  ],
  [
    { name: "founder", label: "Founder", placeholder: "Wrap It Up" },
    { name: "parentKennelCode", label: "Parent Kennel Code", placeholder: "mh3-tn (use kennelCode, not short name)" },
  ],
  [
    { name: "signatureEvent", label: "Signature Event / Annual Turnover", placeholder: "Humpin campout, June/July" },
  ],
];

interface SimilarKennel {
  id: string;
  shortName: string;
  slug: string;
  fullName: string;
  score: number;
}

/** Convert a boolean | null value to a tristate radio default string. */
function triStateDefault(value: boolean | null): string {
  if (value === true) return "true";
  if (value === false) return "false";
  return "";
}

/** Collapsible section used in the kennel form. */
function FormSection({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t pt-3">
      <button
        type="button"
        className="flex items-center gap-1.5 w-full text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
        <span className="text-sm font-semibold">{label}</span>
      </button>
      <div className="space-y-3 pt-3" hidden={!open}>{children}</div>
    </div>
  );
}

/** Tristate radio group (Yes / No / Unknown). */
function TriStateRadio({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <input type="hidden" name={name} value={value} />
      <div className="flex items-center gap-3">
        {[
          { val: "true", text: "Yes" },
          { val: "false", text: "No" },
          { val: "", text: "Unknown" },
        ].map((opt) => (
          <label key={opt.val} className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              checked={value === opt.val}
              onChange={() => setValue(opt.val)}
              className="accent-primary"
            />
            {opt.text}
          </label>
        ))}
      </div>
    </div>
  );
}

export function KennelForm({ kennel, regions, trigger }: Readonly<KennelFormProps>) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [aliases, setAliases] = useState<string[]>(kennel?.aliases ?? []);
  const [aliasInput, setAliasInput] = useState("");
  const [similarKennels, setSimilarKennels] = useState<SimilarKennel[]>([]);
  const [pendingFormData, setPendingFormData] = useState<FormData | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string>(kennel?.regionId ?? "");
  const [isHidden, setIsHidden] = useState(kennel?.isHidden ?? false);
  const shortNameRef = useRef<HTMLInputElement>(null);
  const fullNameRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const selectedRegion = regions.find((r) => r.id === selectedRegionId);

  function addAlias() {
    const trimmed = aliasInput.trim();
    if (trimmed && !aliases.includes(trimmed)) {
      setAliases([...aliases, trimmed]);
    }
    setAliasInput("");
  }

  function removeAlias(alias: string) {
    setAliases(aliases.filter((a) => a !== alias));
  }

  function handleGenerateAliases() {
    const short = shortNameRef.current?.value?.trim() ?? "";
    const full = fullNameRef.current?.value?.trim() ?? "";
    if (!short && !full) {
      toast.error("Enter a short name or full name first");
      return;
    }
    const generated = generateAliases(short, full);
    if (generated.length === 0) {
      toast.info("No aliases could be generated");
      return;
    }
    setAliases((prev) => {
      const seen = new Set(prev.map((a) => a.toLowerCase()));
      const added = generated.filter((a) => !seen.has(a.toLowerCase()));
      if (added.length === 0) {
        setTimeout(() => toast.info("All aliases already present"), 0);
      } else {
        setTimeout(() => toast.success(`Added ${added.length} new alias${added.length !== 1 ? "es" : ""}`), 0);
      }
      return [...prev, ...added];
    });
  }

  function handleSubmitResult(
    result: { error?: string; warning?: string; similarKennels?: SimilarKennel[]; success?: boolean },
    formData: FormData,
  ) {
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    if ("warning" in result && result.similarKennels) {
      setSimilarKennels(result.similarKennels);
      setPendingFormData(formData);
      return;
    }
    toast.success(kennel ? "Kennel updated" : "Kennel created");
    setOpen(false);
    setSimilarKennels([]);
    setPendingFormData(null);
    if (!kennel) setAliases([]);
    router.refresh();
  }

  function handleSubmit(formData: FormData, force = false) {
    if (!selectedRegion) {
      toast.error("Please select a region");
      return;
    }
    formData.set("aliases", aliases.join(","));

    startTransition(async () => {
      const result = kennel
        ? await updateKennel(kennel.id, formData)
        : await createKennel(formData, force);
      handleSubmitResult(result, formData);
    });
  }

  function handleForceCreate() {
    if (pendingFormData) {
      handleSubmit(pendingFormData, true);
    }
  }

  function handleCancelDuplicateWarning() {
    setSimilarKennels([]);
    setPendingFormData(null);
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen);
      if (!isOpen) {
        setSimilarKennels([]);
        setPendingFormData(null);
        setAliases(kennel?.aliases ?? []);
        setSelectedRegionId(kennel?.regionId ?? "");
        setIsHidden(kennel?.isHidden ?? false);
      }
    }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto overscroll-contain sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {kennel ? "Edit Kennel" : "Add Kennel"}
          </DialogTitle>
        </DialogHeader>

        {similarKennels.length > 0 ? (
          // Duplicate warning view
          <div className="space-y-4 py-4">
            <div className="rounded-lg border border-yellow-500 bg-yellow-500/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">⚠️</span>
                <h3 className="font-semibold">Similar kennel(s) found</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                We found existing kennels with similar names. Are you sure you want to create a new kennel?
              </p>
              <div className="space-y-2">
                {similarKennels.map((similar) => (
                  <div
                    key={similar.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-background"
                  >
                    <div>
                      <div className="font-medium">{similar.shortName}</div>
                      <div className="text-sm text-muted-foreground">{similar.fullName}</div>
                    </div>
                    <Badge variant="secondary">
                      {Math.round(similar.score * 100)}% match
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancelDuplicateWarning}
              >
                Go Back
              </Button>
              <Button
                type="button"
                onClick={handleForceCreate}
                disabled={isPending}
              >
                {isPending ? "Creating..." : "Create Anyway"}
              </Button>
            </div>
          </div>
        ) : (
          // Normal form view
          <form action={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="shortName">Short Name *</Label>
              <Input
                ref={shortNameRef}
                id="shortName"
                name="shortName"
                required
                defaultValue={kennel?.shortName ?? ""}
                placeholder="NYCH3"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name *</Label>
              <Input
                ref={fullNameRef}
                id="fullName"
                name="fullName"
                required
                defaultValue={kennel?.fullName ?? ""}
                placeholder="New York City Hash House Harriers"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Region *</Label>
              <input type="hidden" name="regionId" value={selectedRegionId} />
              <input type="hidden" name="region" value={selectedRegion?.name ?? ""} />
              <RegionCombobox
                value={selectedRegionId}
                regions={regions}
                onSelect={setSelectedRegionId}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                name="country"
                defaultValue={kennel?.country ?? "USA"}
                placeholder="USA"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              defaultValue={kennel?.description ?? ""}
              placeholder="About this kennel..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              name="website"
              type="url"
              defaultValue={kennel?.website ?? ""}
              placeholder="https://example.com"
            />
          </div>

          {/* Hidden from public */}
          <div className="flex items-center gap-2">
            <input type="hidden" name="isHidden" value={isHidden ? "true" : "false"} />
            <input
              type="checkbox"
              id="isHidden"
              checked={isHidden}
              onChange={(e) => setIsHidden(e.target.checked)}
              className="accent-primary"
            />
            <Label htmlFor="isHidden" className="cursor-pointer text-sm font-normal">
              Hidden from public directory and hareline
            </Label>
          </div>

          <div className="space-y-2">
            <Label>Aliases</Label>
            <div className="flex gap-2">
              <Input
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAlias();
                  }
                }}
                placeholder="Add alias and press Enter"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addAlias}
              >
                Add
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGenerateAliases}
              >
                Generate
              </Button>
            </div>
            {aliases.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {aliases.map((alias) => (
                  <Badge
                    key={alias}
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() => removeAlias(alias)}
                  >
                    {alias} &times;
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Hidden field to carry aliases through FormData */}
          <input type="hidden" name="aliases" value={aliases.join(",")} />

          {/* ── Schedule Section ── */}
          <FormSection label="Schedule" defaultOpen={!!kennel?.scheduleDayOfWeek}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="scheduleDayOfWeek">Day of Week</Label>
                <Input
                  id="scheduleDayOfWeek"
                  name="scheduleDayOfWeek"
                  defaultValue={kennel?.scheduleDayOfWeek ?? ""}
                  placeholder="Wednesday"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scheduleTime">Time</Label>
                <Input
                  id="scheduleTime"
                  name="scheduleTime"
                  defaultValue={kennel?.scheduleTime ?? ""}
                  placeholder="7:00 PM"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="scheduleFrequency">Frequency</Label>
                <Input
                  id="scheduleFrequency"
                  name="scheduleFrequency"
                  defaultValue={kennel?.scheduleFrequency ?? ""}
                  placeholder="Weekly, Biweekly, Monthly..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scheduleNotes">Schedule Notes</Label>
                <Input
                  id="scheduleNotes"
                  name="scheduleNotes"
                  defaultValue={kennel?.scheduleNotes ?? ""}
                  placeholder="Summer: Mon 7pm, Winter: Sun 2pm"
                />
              </div>
            </div>
          </FormSection>

          {/* ── Social & Contact Section ── */}
          <FormSection label="Social & Contact" defaultOpen={!!kennel?.facebookUrl || !!kennel?.contactEmail}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="facebookUrl">Facebook URL</Label>
                <Input
                  id="facebookUrl"
                  name="facebookUrl"
                  type="url"
                  defaultValue={kennel?.facebookUrl ?? ""}
                  placeholder="https://facebook.com/groups/..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instagramHandle">Instagram Handle</Label>
                <Input
                  id="instagramHandle"
                  name="instagramHandle"
                  defaultValue={kennel?.instagramHandle ?? ""}
                  placeholder="@kennel_name"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="twitterHandle">X / Twitter Handle</Label>
                <Input
                  id="twitterHandle"
                  name="twitterHandle"
                  defaultValue={kennel?.twitterHandle ?? ""}
                  placeholder="@kennel_name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="discordUrl">Discord URL</Label>
                <Input
                  id="discordUrl"
                  name="discordUrl"
                  type="url"
                  defaultValue={kennel?.discordUrl ?? ""}
                  placeholder="https://discord.gg/..."
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="mailingListUrl">Mailing List URL</Label>
                <Input
                  id="mailingListUrl"
                  name="mailingListUrl"
                  type="url"
                  defaultValue={kennel?.mailingListUrl ?? ""}
                  placeholder="https://groups.google.com/..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactEmail">Contact Email</Label>
                <Input
                  id="contactEmail"
                  name="contactEmail"
                  type="email"
                  defaultValue={kennel?.contactEmail ?? ""}
                  placeholder="gm@kennel.com"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactName">Contact Name</Label>
              <Input
                id="contactName"
                name="contactName"
                defaultValue={kennel?.contactName ?? ""}
                placeholder="Grand Master: Mudflap"
              />
            </div>
          </FormSection>

          {/* ── Profile Section (#1415) ── */}
          <FormSection
            label="Profile"
            defaultOpen={
              !!kennel?.gm ||
              !!kennel?.hareRaiser ||
              !!kennel?.signatureEvent ||
              !!kennel?.founder ||
              !!kennel?.parentKennelCode
            }
          >
            {PROFILE_FIELD_GROUPS.map((group) => (
              <div key={group[0].name} className={group.length > 1 ? "grid gap-4 sm:grid-cols-2" : "space-y-2"}>
                {group.map(({ name, label, placeholder }) => (
                  <div key={name} className="space-y-2">
                    <Label htmlFor={name}>{label}</Label>
                    <Input
                      id={name}
                      name={name}
                      defaultValue={kennel?.[name] ?? ""}
                      placeholder={placeholder}
                    />
                  </div>
                ))}
              </div>
            ))}
          </FormSection>

          {/* ── Details Section ── */}
          <FormSection label="Details" defaultOpen={!!kennel?.hashCash || !!kennel?.foundedYear}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="hashCash">Hash Cash</Label>
                <Input
                  id="hashCash"
                  name="hashCash"
                  defaultValue={kennel?.hashCash ?? ""}
                  placeholder="$5, Free, $7/$10 visitor"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="paymentLink">Payment Link</Label>
                <Input
                  id="paymentLink"
                  name="paymentLink"
                  type="url"
                  defaultValue={kennel?.paymentLink ?? ""}
                  placeholder="https://venmo.com/..."
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="foundedYear">Founded Year</Label>
                <Input
                  id="foundedYear"
                  name="foundedYear"
                  type="number"
                  defaultValue={kennel?.foundedYear?.toString() ?? ""}
                  placeholder="1975"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="logoUrl">Logo URL</Label>
                <Input
                  id="logoUrl"
                  name="logoUrl"
                  type="url"
                  defaultValue={kennel?.logoUrl ?? ""}
                  placeholder="https://example.com/logo.png"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TriStateRadio
                name="dogFriendly"
                label="Dog Friendly"
                defaultValue={triStateDefault(kennel?.dogFriendly ?? null)}
              />
              <TriStateRadio
                name="walkersWelcome"
                label="Walkers Welcome"
                defaultValue={triStateDefault(kennel?.walkersWelcome ?? null)}
              />
            </div>
          </FormSection>

          {/* ── Location Section ── */}
          <FormSection label="Location" defaultOpen={kennel?.latitude != null}>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Coordinates</Label>
                <GeocodeButton
                  getAddress={() => {
                    const fullName = fullNameRef.current?.value?.trim();
                    if (!fullName) {
                      toast.error("Enter a full name first");
                      return null;
                    }
                    const region = selectedRegion?.name ?? "";
                    const country = (document.getElementById("country") as HTMLInputElement)?.value?.trim();
                    return [fullName, region, country].filter(Boolean).join(", ");
                  }}
                  latInputId="latitude"
                  lngInputId="longitude"
                  geocode={geocodeAction}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="latitude" className="text-xs text-muted-foreground">Lat</Label>
                  <Input
                    id="latitude"
                    name="latitude"
                    type="number"
                    step="any"
                    defaultValue={kennel?.latitude ?? ""}
                    placeholder="40.71"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="longitude" className="text-xs text-muted-foreground">Lng</Label>
                  <Input
                    id="longitude"
                    name="longitude"
                    type="number"
                    step="any"
                    defaultValue={kennel?.longitude ?? ""}
                    placeholder="-74.01"
                  />
                </div>
              </div>
            </div>
          </FormSection>

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
                  : kennel
                    ? "Save Changes"
                    : "Create Kennel"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
