"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addKennelFromResearch } from "@/app/admin/research/actions";

interface Props {
  discovery: {
    id: string;
    name: string;
    externalSlug: string;
    website: string | null;
    location: string | null;
    schedule: string | null;
    yearStarted: number | null;
    regionId: string | null;
  };
  regionId: string;
  onClose: () => void;
}

export function AddKennelFromResearchDialog({ discovery, regionId, onClose }: Readonly<Props>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Parse schedule into frequency/day if possible
  const scheduleParts = discovery.schedule?.split(",").map((s) => s.trim()) ?? [];

  const [shortName, setShortName] = useState(discovery.externalSlug);
  const [fullName, setFullName] = useState(discovery.name);
  const [website, setWebsite] = useState(discovery.website ?? "");
  const [foundedYear, setFoundedYear] = useState(discovery.yearStarted?.toString() ?? "");
  const [scheduleFrequency, setScheduleFrequency] = useState(scheduleParts[0] ?? "");
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(scheduleParts[1] ?? "");

  function handleSubmit() {
    if (!shortName.trim() || !fullName.trim()) {
      toast.error("Short name and full name are required");
      return;
    }

    startTransition(async () => {
      const result = await addKennelFromResearch(discovery.id, {
        shortName: shortName.trim(),
        fullName: fullName.trim(),
        regionId: discovery.regionId ?? regionId,
        website: website || undefined,
        foundedYear: foundedYear ? parseInt(foundedYear, 10) : undefined,
        scheduleFrequency: scheduleFrequency || undefined,
        scheduleDayOfWeek: scheduleDayOfWeek || undefined,
      });

      if ("error" in result && result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Kennel "${shortName}" created`);
        router.refresh();
        onClose();
      }
    });
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Kennel from Research</DialogTitle>
          <DialogDescription>
            Create a new kennel from the AI-discovered data.
            {discovery.location && ` Location: ${discovery.location}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="shortName">Short Name</Label>
              <Input
                id="shortName"
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                placeholder="e.g., EBH3"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g., East Bay H3"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://..."
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="foundedYear">Founded</Label>
              <Input
                id="foundedYear"
                value={foundedYear}
                onChange={(e) => setFoundedYear(e.target.value)}
                placeholder="e.g., 1999"
                type="number"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="frequency">Frequency</Label>
              <Input
                id="frequency"
                value={scheduleFrequency}
                onChange={(e) => setScheduleFrequency(e.target.value)}
                placeholder="Weekly"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="day">Day</Label>
              <Input
                id="day"
                value={scheduleDayOfWeek}
                onChange={(e) => setScheduleDayOfWeek(e.target.value)}
                placeholder="Saturday"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Creating..." : "Add Kennel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
