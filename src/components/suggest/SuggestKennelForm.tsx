"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  submitKennelSuggestion,
  type SuggestionState,
} from "@/app/suggest/actions";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Send } from "lucide-react";

interface SuggestKennelFormProps {
  onSuccess?: () => void;
}

export function SuggestKennelForm({ onSuccess }: SuggestKennelFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState<
    SuggestionState,
    FormData
  >(submitKennelSuggestion, null);

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
    <form ref={formRef} action={formAction} className="space-y-6">
      {/* Honeypot */}
      <input
        name="website_url_confirm"
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
      />

      {/* Section: About the kennel */}
      <fieldset className="space-y-4">
        <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          About the kennel
        </legend>

        <div className="space-y-2">
          <Label htmlFor="suggest-kennelName">
            Kennel Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="suggest-kennelName"
            name="kennelName"
            required
            placeholder="e.g., Capital City H3"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="suggest-region">
            City / Region <span className="text-destructive">*</span>
          </Label>
          <Input
            id="suggest-region"
            name="region"
            required
            placeholder="e.g., Austin, TX"
          />
          <p className="text-xs text-muted-foreground">
            Where does this kennel primarily run?
          </p>
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
      </fieldset>

      {/* Divider */}
      <div className="border-t" />

      {/* Section: About you */}
      <fieldset className="space-y-4">
        <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          About you
        </legend>

        <div className="space-y-3">
          <Label>
            How do you know this kennel?{" "}
            <span className="text-destructive">*</span>
          </Label>
          <RadioGroup name="relationship" required className="space-y-2">
            <label
              htmlFor="rel-hash-with"
              className="flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors hover:bg-accent/50 has-[input:checked]:border-primary has-[input:checked]:bg-primary/5"
            >
              <RadioGroupItem value="HASH_WITH" id="rel-hash-with" />
              <div>
                <span className="text-sm font-medium">I hash with them</span>
                <p className="text-xs text-muted-foreground">
                  I run with this kennel regularly or occasionally
                </p>
              </div>
            </label>
            <label
              htmlFor="rel-misman"
              className="flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors hover:bg-accent/50 has-[input:checked]:border-primary has-[input:checked]:bg-primary/5"
            >
              <RadioGroupItem value="ON_MISMAN" id="rel-misman" />
              <div>
                <span className="text-sm font-medium">
                  I&apos;m on misman
                </span>
                <p className="text-xs text-muted-foreground">
                  I manage attendance for this kennel
                </p>
              </div>
            </label>
            <label
              htmlFor="rel-found-online"
              className="flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors hover:bg-accent/50 has-[input:checked]:border-primary has-[input:checked]:bg-primary/5"
            >
              <RadioGroupItem value="FOUND_ONLINE" id="rel-found-online" />
              <div>
                <span className="text-sm font-medium">
                  I found them online
                </span>
                <p className="text-xs text-muted-foreground">
                  I discovered this kennel while searching
                </p>
              </div>
            </label>
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label htmlFor="suggest-email">Email (optional)</Label>
          <Input
            id="suggest-email"
            name="email"
            type="email"
            placeholder="your@email.com"
          />
          <p className="text-xs text-muted-foreground">
            So we can let you know when the kennel is added
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="suggest-notes">Notes</Label>
          <Textarea
            id="suggest-notes"
            name="notes"
            rows={3}
            placeholder="Anything else we should know? (run schedule, social media links, etc.)"
          />
        </div>
      </fieldset>

      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Submitting...
          </>
        ) : (
          <>
            <Send className="mr-2 h-4 w-4" />
            Suggest Kennel
          </>
        )}
      </Button>
    </form>
  );
}
