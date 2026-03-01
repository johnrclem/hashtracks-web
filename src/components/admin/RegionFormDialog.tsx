"use client";

import { useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { createRegion, updateRegion } from "@/app/admin/regions/actions";
import { useRouter } from "next/navigation";
import type { RegionRow } from "./RegionTable";

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Rome",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
];

export function RegionFormDialog({
  region,
  regions,
  onClose,
}: Readonly<{
  region?: RegionRow;
  regions: RegionRow[];
  onClose: () => void;
}>) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isEdit = !!region;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = isEdit
        ? await updateRegion(region.id, formData)
        : await createRegion(formData);

      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(isEdit ? `Updated "${String(formData.get("name"))}"` : "Region created");
        router.refresh();
        onClose();
      }
    });
  }

  // Filter out current region from parent options
  const parentOptions = regions.filter(
    (r) => r.id !== region?.id && !r.parentId,
  );

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Region" : "Add Region"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={region?.name ?? ""}
                placeholder="New York City, NY"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="abbrev">Abbreviation *</Label>
              <Input
                id="abbrev"
                name="abbrev"
                required
                defaultValue={region?.abbrev ?? ""}
                placeholder="NYC"
                maxLength={6}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="country">Country *</Label>
              <Input
                id="country"
                name="country"
                required
                defaultValue={region?.country ?? "USA"}
                placeholder="USA"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone *</Label>
              <Select
                name="timezone"
                defaultValue={region?.timezone ?? "America/New_York"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="colorClasses">Badge Classes *</Label>
              <Input
                id="colorClasses"
                name="colorClasses"
                required
                defaultValue={region?.colorClasses ?? "bg-gray-200 text-gray-800"}
                placeholder="bg-blue-200 text-blue-800"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pinColor">Pin Color (hex) *</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="pinColor"
                  name="pinColor"
                  required
                  defaultValue={region?.pinColor ?? "#6b7280"}
                  placeholder="#2563eb"
                  className="flex-1"
                />
                <div
                  className="h-8 w-8 rounded-full border flex-shrink-0"
                  style={{ backgroundColor: region?.pinColor ?? "#6b7280" }}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="centroidLat">Centroid Lat</Label>
              <Input
                id="centroidLat"
                name="centroidLat"
                type="number"
                step="any"
                defaultValue={region?.centroidLat ?? ""}
                placeholder="40.71"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="centroidLng">Centroid Lng</Label>
              <Input
                id="centroidLng"
                name="centroidLng"
                type="number"
                step="any"
                defaultValue={region?.centroidLng ?? ""}
                placeholder="-74.01"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="parentId">Parent Region</Label>
            <Select
              name="parentId"
              defaultValue={region?.parentId ?? "none"}
            >
              <SelectTrigger>
                <SelectValue placeholder="None (top-level)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (top-level)</SelectItem>
                {parentOptions.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : (isEdit ? "Update" : "Create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
