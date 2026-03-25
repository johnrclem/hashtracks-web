"use client";

import { useActionState, useEffect, useRef } from "react";
import { submitKennelSuggestion, type SuggestionState } from "@/app/suggest/actions";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface SuggestKennelFormProps {
  onSuccess?: () => void;
}

export function SuggestKennelForm({ onSuccess }: SuggestKennelFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState<SuggestionState, FormData>(
    submitKennelSuggestion,
    null,
  );

  useEffect(() => {
    if (!state) return;

    if (state.success) {
      toast.success("Thanks! We'll look into adding this kennel.");
      formRef.current?.reset();
      onSuccess?.();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, onSuccess]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {/* Honeypot — hidden from real users, bots fill it */}
      <input
        name="website_url_confirm"
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
      />

      <div className="space-y-2">
        <Label htmlFor="suggest-kennelName">Kennel Name *</Label>
        <Input
          id="suggest-kennelName"
          name="kennelName"
          required
          placeholder="e.g., Capital City H3"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="suggest-region">Region *</Label>
        <Input
          id="suggest-region"
          name="region"
          required
          placeholder="e.g., Austin, TX"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="suggest-sourceUrl">Website or Facebook Page</Label>
        <Input
          id="suggest-sourceUrl"
          name="sourceUrl"
          type="url"
          placeholder="https://..."
        />
      </div>

      <div className="space-y-2">
        <Label>How do you know this kennel? *</Label>
        <RadioGroup name="relationship" required>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="HASH_WITH" id="rel-hash-with" />
            <Label htmlFor="rel-hash-with" className="font-normal cursor-pointer">
              I hash with them
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="ON_MISMAN" id="rel-misman" />
            <Label htmlFor="rel-misman" className="font-normal cursor-pointer">
              I&apos;m on misman (attendance manager)
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="FOUND_ONLINE" id="rel-found-online" />
            <Label htmlFor="rel-found-online" className="font-normal cursor-pointer">
              I found them online
            </Label>
          </div>
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <Label htmlFor="suggest-email">Email (optional, for follow-up)</Label>
        <Input
          id="suggest-email"
          name="email"
          type="email"
          placeholder="your@email.com"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="suggest-notes">Notes</Label>
        <Textarea
          id="suggest-notes"
          name="notes"
          rows={3}
          placeholder="Anything else we should know?"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Submitting..." : "Suggest Kennel"}
      </Button>
    </form>
  );
}
