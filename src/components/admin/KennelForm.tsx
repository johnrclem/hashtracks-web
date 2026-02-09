"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createKennel, updateKennel } from "@/app/admin/kennels/actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type KennelData = {
  id: string;
  shortName: string;
  fullName: string;
  region: string;
  country: string;
  description: string | null;
  website: string | null;
  aliases: string[];
};

interface KennelFormProps {
  kennel?: KennelData;
  trigger: React.ReactNode;
}

export function KennelForm({ kennel, trigger }: KennelFormProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [aliases, setAliases] = useState<string[]>(kennel?.aliases ?? []);
  const [aliasInput, setAliasInput] = useState("");
  const router = useRouter();

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

  function handleSubmit(formData: FormData) {
    // Inject aliases as comma-separated string
    formData.set("aliases", aliases.join(","));

    startTransition(async () => {
      const result = kennel
        ? await updateKennel(kennel.id, formData)
        : await createKennel(formData);

      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(kennel ? "Kennel updated" : "Kennel created");
        setOpen(false);
        if (!kennel) {
          setAliases([]);
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
            {kennel ? "Edit Kennel" : "Add Kennel"}
          </DialogTitle>
        </DialogHeader>

        <form action={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="shortName">Short Name *</Label>
              <Input
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
              <Label htmlFor="region">Region *</Label>
              <Input
                id="region"
                name="region"
                required
                defaultValue={kennel?.region ?? ""}
                placeholder="New York City, NY"
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
      </DialogContent>
    </Dialog>
  );
}
