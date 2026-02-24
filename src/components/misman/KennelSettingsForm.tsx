"use client";

import { useRef, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateKennelSettings } from "@/app/misman/[slug]/settings/actions";

interface KennelData {
  id: string;
  shortName: string;
  description: string | null;
  website: string | null;
  scheduleDayOfWeek: string | null;
  scheduleTime: string | null;
  scheduleFrequency: string | null;
  scheduleNotes: string | null;
  facebookUrl: string | null;
  instagramHandle: string | null;
  twitterHandle: string | null;
  discordUrl: string | null;
  mailingListUrl: string | null;
  contactEmail: string | null;
  contactName: string | null;
  hashCash: string | null;
  paymentLink: string | null;
  foundedYear: number | null;
  logoUrl: string | null;
  dogFriendly: boolean | null;
  walkersWelcome: boolean | null;
}

interface KennelSettingsFormProps {
  kennel: KennelData;
}

function triStateValue(val: boolean | null): string {
  if (val === true) return "true";
  if (val === false) return "false";
  return "";
}

export function KennelSettingsForm({ kennel }: KennelSettingsFormProps) {
  const formRef = useRef<HTMLFormElement>(undefined);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    startTransition(async () => {
      const result = await updateKennelSettings(kennel.id, formData);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Profile updated");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-8">
      {/* Basic Info */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Basic Info
        </h3>
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={kennel.description ?? ""}
            placeholder="About this kennel…"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="website">Website</Label>
          <Input
            id="website"
            name="website"
            type="url"
            defaultValue={kennel.website ?? ""}
            placeholder="https://nych3.com"
          />
        </div>
      </div>

      <Separator />

      {/* Schedule */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Schedule
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="scheduleDayOfWeek">Day of Week</Label>
            <Input
              id="scheduleDayOfWeek"
              name="scheduleDayOfWeek"
              defaultValue={kennel.scheduleDayOfWeek ?? ""}
              placeholder="Monday"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scheduleTime">Start Time</Label>
            <Input
              id="scheduleTime"
              name="scheduleTime"
              defaultValue={kennel.scheduleTime ?? ""}
              placeholder="7:00 PM"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scheduleFrequency">Frequency</Label>
            <Input
              id="scheduleFrequency"
              name="scheduleFrequency"
              defaultValue={kennel.scheduleFrequency ?? ""}
              placeholder="Weekly"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scheduleNotes">Schedule Notes</Label>
            <Input
              id="scheduleNotes"
              name="scheduleNotes"
              defaultValue={kennel.scheduleNotes ?? ""}
              placeholder="Summer: Mon 7pm"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Social & Contact */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Social &amp; Contact
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="facebookUrl">Facebook URL</Label>
            <Input
              id="facebookUrl"
              name="facebookUrl"
              type="url"
              defaultValue={kennel.facebookUrl ?? ""}
              placeholder="https://facebook.com/nych3"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="instagramHandle">Instagram Handle</Label>
            <Input
              id="instagramHandle"
              name="instagramHandle"
              defaultValue={kennel.instagramHandle ?? ""}
              placeholder="@nych3"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="twitterHandle">X / Twitter Handle</Label>
            <Input
              id="twitterHandle"
              name="twitterHandle"
              defaultValue={kennel.twitterHandle ?? ""}
              placeholder="@nych3"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="discordUrl">Discord URL</Label>
            <Input
              id="discordUrl"
              name="discordUrl"
              type="url"
              defaultValue={kennel.discordUrl ?? ""}
              placeholder="https://discord.gg/…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mailingListUrl">Mailing List URL</Label>
            <Input
              id="mailingListUrl"
              name="mailingListUrl"
              type="url"
              defaultValue={kennel.mailingListUrl ?? ""}
              placeholder="https://groups.google.com/…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contactEmail">Contact Email</Label>
            <Input
              id="contactEmail"
              name="contactEmail"
              type="email"
              defaultValue={kennel.contactEmail ?? ""}
              placeholder="hash@example.com"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="contactName">Contact Name / Role</Label>
            <Input
              id="contactName"
              name="contactName"
              defaultValue={kennel.contactName ?? ""}
              placeholder="Grand Master: Mudflap"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Details */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Details
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="hashCash">Hash Cash</Label>
            <Input
              id="hashCash"
              name="hashCash"
              defaultValue={kennel.hashCash ?? ""}
              placeholder="$5, Free, $7/$10 visitor"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="paymentLink">Payment Link</Label>
            <Input
              id="paymentLink"
              name="paymentLink"
              type="url"
              defaultValue={kennel.paymentLink ?? ""}
              placeholder="https://venmo.com/…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="foundedYear">Founded Year</Label>
            <Input
              id="foundedYear"
              name="foundedYear"
              type="number"
              min={1938}
              max={new Date().getFullYear()}
              defaultValue={kennel.foundedYear ?? ""}
              placeholder="1990"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="logoUrl">Logo URL</Label>
            <Input
              id="logoUrl"
              name="logoUrl"
              type="url"
              defaultValue={kennel.logoUrl ?? ""}
              placeholder="https://…/logo.png"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dogFriendly">Dog Friendly</Label>
            <Select name="dogFriendly" defaultValue={triStateValue(kennel.dogFriendly)}>
              <SelectTrigger id="dogFriendly">
                <SelectValue placeholder="Unknown" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Unknown</SelectItem>
                <SelectItem value="true">Yes</SelectItem>
                <SelectItem value="false">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="walkersWelcome">Walkers Welcome</Label>
            <Select name="walkersWelcome" defaultValue={triStateValue(kennel.walkersWelcome)}>
              <SelectTrigger id="walkersWelcome">
                <SelectValue placeholder="Unknown" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Unknown</SelectItem>
                <SelectItem value="true">Yes</SelectItem>
                <SelectItem value="false">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save changes
        </Button>
      </div>
    </form>
  );
}
