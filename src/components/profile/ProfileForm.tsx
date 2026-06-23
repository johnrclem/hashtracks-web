"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { updateProfile } from "@/app/profile/actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/profile/UserAvatar";
import { resolveAvatarSrc } from "@/lib/avatar";
import { toast } from "sonner";

interface ProfileFormProps {
  user: {
    id: string;
    email: string;
    hashName: string | null;
    nerdName: string | null;
    bio: string | null;
    avatarUrl: string | null;
    clerkImageUrl: string | null;
    hideClerkImage: boolean;
    attendanceVisibility: "PUBLIC" | "PRIVATE";
  };
}

export function ProfileForm({ user }: ProfileFormProps) {
  const [state, formAction, isPending] = useActionState(updateProfile, null);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [hideClerkImage, setHideClerkImage] = useState(user.hideClerkImage);
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">(user.attendanceVisibility);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.success) toast.success("Profile updated");
    if (state?.error) toast.error(state.error);
  }, [state]);

  // Live preview as the user uploads / toggles "hide my account photo".
  const previewSrc = resolveAvatarSrc({
    avatarUrl: avatarUrl || null,
    clerkImageUrl: user.clerkImageUrl,
    hideClerkImage,
  });

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after an error
    if (!file) return;
    // Match the route's onBeforeGenerateToken limits so bad files fail instantly.
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      toast.error("Photo must be a PNG, JPEG, WebP, or GIF image");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Photo must be under 2 MB");
      return;
    }
    setUploading(true);
    try {
      // Streams directly to Vercel Blob; the route only mints a scoped token.
      // Namespace under avatars/<userId>/ so the route can bind the object to
      // this user (verified again server-side in updateProfile via head()).
      const blob = await upload(`avatars/${user.id}/${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/user/avatar/upload",
      });
      setAvatarUrl(blob.url);
      toast.success("Photo uploaded — save to apply");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setUploading(false);
    }
  }

  let uploadLabel = "Upload photo";
  if (uploading) uploadLabel = "Uploading…";
  else if (avatarUrl) uploadLabel = "Change photo";

  return (
    <form action={formAction} className="space-y-4">
      {/* Controlled values submitted to the action (deterministic, always present). */}
      <input type="hidden" name="avatarUrl" value={avatarUrl} />
      <input type="hidden" name="hideClerkImage" value={hideClerkImage ? "true" : "false"} />
      <input type="hidden" name="attendanceVisibility" value={visibility} />

      <div className="space-y-2">
        <Label>Profile Photo</Label>
        <div className="flex items-center gap-4">
          <UserAvatar src={previewSrc} alt="Your profile photo" size={64} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploadLabel}
            </Button>
            {avatarUrl && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAvatarUrl("")}>
                Remove
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={handleAvatarUpload}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={hideClerkImage}
            onChange={(e) => setHideClerkImage(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          <span>Hide my account (Google) photo — show a generic hash logo instead</span>
        </label>
      </div>

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
        <p className="text-xs text-muted-foreground mt-1">Visible to all hashers</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="nerdName">Nerd Name</Label>
        <Input
          id="nerdName"
          name="nerdName"
          defaultValue={user.nerdName ?? ""}
          placeholder="Your real name (private)"
        />
        <p className="text-xs text-muted-foreground mt-1">Only visible to you and kennel mismanagement</p>
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

      <div className="space-y-2">
        <Label>Attendance Visibility</Label>
        <div className="space-y-1.5">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="visibilityChoice"
              checked={visibility === "PRIVATE"}
              onChange={() => setVisibility("PRIVATE")}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Private</span> — your name isn’t listed on past trails
              (unless you hared).
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="visibilityChoice"
              checked={visibility === "PUBLIC"}
              onChange={() => setVisibility("PUBLIC")}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Public</span> — show my name on past trails I’ve attended.
            </span>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">Hares are always shown publicly.</p>
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Save Profile"}
      </Button>
    </form>
  );
}
