"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  createKennelHasher,
  updateKennelHasher,
} from "@/app/misman/[slug]/roster/actions";

interface HasherData {
  id: string;
  hashName: string | null;
  nerdName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

interface HasherFormProps {
  open: boolean;
  onClose: () => void;
  kennelId: string;
  kennelSlug: string;
  hasher?: HasherData;
}

export function HasherForm({
  open,
  onClose,
  kennelId,
  kennelSlug,
  hasher,
}: HasherFormProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isEditing = !!hasher;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      hashName: formData.get("hashName") as string,
      nerdName: formData.get("nerdName") as string,
      email: formData.get("email") as string,
      phone: formData.get("phone") as string,
      notes: formData.get("notes") as string,
    };

    startTransition(async () => {
      const result = isEditing
        ? await updateKennelHasher(hasher!.id, data)
        : await createKennelHasher(kennelId, data);

      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(isEditing ? "Hasher updated" : "Hasher added to roster");
        onClose();
      }
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Hasher" : "Add Hasher"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hashName">Hash Name</Label>
            <Input
              id="hashName"
              name="hashName"
              defaultValue={hasher?.hashName ?? ""}
              placeholder="e.g., Mudflap"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nerdName">Nerd Name</Label>
            <Input
              id="nerdName"
              name="nerdName"
              defaultValue={hasher?.nerdName ?? ""}
              placeholder="Real name (private)"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={hasher?.email ?? ""}
              placeholder="Contact email (private)"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              defaultValue={hasher?.phone ?? ""}
              placeholder="Mobile number (private)"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              defaultValue={hasher?.notes ?? ""}
              placeholder="Internal notes"
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : isEditing ? "Save Changes" : "Add Hasher"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
