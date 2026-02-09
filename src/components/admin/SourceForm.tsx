"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSource, updateSource } from "@/app/admin/sources/actions";
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
import { toast } from "sonner";

const SOURCE_TYPES = [
  "HTML_SCRAPER",
  "GOOGLE_CALENDAR",
  "GOOGLE_SHEETS",
  "ICAL_FEED",
  "RSS_FEED",
  "JSON_API",
  "MANUAL",
] as const;

type SourceData = {
  id: string;
  name: string;
  url: string;
  type: string;
  trustLevel: number;
  scrapeFreq: string;
  linkedKennelIds: string[];
};

interface SourceFormProps {
  source?: SourceData;
  allKennels: { id: string; shortName: string }[];
  trigger: React.ReactNode;
}

export function SourceForm({ source, allKennels, trigger }: SourceFormProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selectedKennels, setSelectedKennels] = useState<string[]>(
    source?.linkedKennelIds ?? [],
  );
  const router = useRouter();

  function toggleKennel(kennelId: string) {
    setSelectedKennels((prev) =>
      prev.includes(kennelId)
        ? prev.filter((id) => id !== kennelId)
        : [...prev, kennelId],
    );
  }

  function handleSubmit(formData: FormData) {
    formData.set("kennelIds", selectedKennels.join(","));

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
        }
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {source ? "Edit Source" : "Add Source"}
          </DialogTitle>
        </DialogHeader>

        <form action={handleSubmit} className="space-y-4">
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
              <Select name="type" defaultValue={source?.type ?? "HTML_SCRAPER"}>
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
          </div>

          <div className="space-y-2">
            <Label>Linked Kennels</Label>
            <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto rounded-md border p-2">
              {allKennels.map((kennel) => (
                <Badge
                  key={kennel.id}
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
              ))}
            </div>
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
