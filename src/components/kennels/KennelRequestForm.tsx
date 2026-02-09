"use client";

import { useActionState } from "react";
import { submitKennelRequest } from "@/app/kennels/request/actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function KennelRequestForm() {
  const [state, formAction, isPending] = useActionState(
    submitKennelRequest,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      <div className="space-y-2">
        <Label htmlFor="kennelName">Kennel Name *</Label>
        <Input
          id="kennelName"
          name="kennelName"
          required
          placeholder='e.g., "Philly H3" or "Philadelphia Hash House Harriers"'
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="region">Region</Label>
        <Input
          id="region"
          name="region"
          placeholder="e.g., Philadelphia, PA"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="country">Country</Label>
        <Input
          id="country"
          name="country"
          defaultValue="USA"
          placeholder="USA"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sourceUrl">Website or Facebook Page</Label>
        <Input
          id="sourceUrl"
          name="sourceUrl"
          placeholder="https://..."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          placeholder="Any additional info about this kennel..."
        />
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Submitting..." : "Submit Request"}
      </Button>
    </form>
  );
}
