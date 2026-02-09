"use client";

import { useActionState, useEffect } from "react";
import { updateProfile } from "@/app/profile/actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ProfileFormProps {
  user: {
    email: string;
    hashName: string | null;
    nerdName: string | null;
    bio: string | null;
  };
}

export function ProfileForm({ user }: ProfileFormProps) {
  const [state, formAction, isPending] = useActionState(updateProfile, null);

  useEffect(() => {
    if (state?.success) toast.success("Profile updated");
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={user.email} disabled className="bg-muted" />
        <p className="text-xs text-muted-foreground">
          Managed by your sign-in provider
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="hashName">Hash Name</Label>
        <Input
          id="hashName"
          name="hashName"
          defaultValue={user.hashName ?? ""}
          placeholder="Your hash name (public)"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="nerdName">Nerd Name</Label>
        <Input
          id="nerdName"
          name="nerdName"
          defaultValue={user.nerdName ?? ""}
          placeholder="Your real name (private)"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="bio">Bio</Label>
        <Textarea
          id="bio"
          name="bio"
          defaultValue={user.bio ?? ""}
          placeholder="Tell the hash a little about yourself..."
          rows={3}
        />
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Save Profile"}
      </Button>
    </form>
  );
}
