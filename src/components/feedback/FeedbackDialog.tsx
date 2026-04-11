"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useUser, SignInButton } from "@clerk/nextjs";
import { submitFeedback } from "@/app/feedback/actions";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const triggerClass = "text-foreground/80 transition-colors hover:text-foreground";

/**
 * Footer/menu trigger for submitting user feedback.
 *
 * Renders for all visitors. Signed-out users get a sign-in modal on click;
 * signed-in users get the feedback form dialog. While Clerk is still loading
 * auth state we render nothing to avoid flashing the wrong trigger.
 */
export function FeedbackDialog() {
  const { isLoaded, isSignedIn } = useUser();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(submitFeedback, null);

  // Handle success/error after submission
  useEffect(() => {
    if (!state) return;

    if (state.success) {
      // Analytics captured server-side in submitFeedback action with actual category
      toast.success("Feedback submitted — thank you!");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      formRef.current?.reset();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  // Wait for Clerk so signed-in users never briefly see the sign-in CTA
  if (!isLoaded) return null;

  if (!isSignedIn) {
    return (
      <SignInButton mode="modal">
        <button type="button" className={triggerClass}>Send Feedback</button>
      </SignInButton>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={triggerClass}>Send Feedback</button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send Feedback</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={formAction} className="space-y-4">
          <input type="hidden" name="pageUrl" value={pathname} />

          <div className="space-y-2">
            <Label htmlFor="feedback-category">Category</Label>
            <Select name="category" defaultValue="bug">
              <SelectTrigger id="feedback-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bug">Bug Report</SelectItem>
                <SelectItem value="feature">Feature Request</SelectItem>
                <SelectItem value="question">Question</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-title">Title *</Label>
            <Input
              id="feedback-title"
              name="title"
              required
              placeholder="Brief summary"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-description">Description *</Label>
            <Textarea
              id="feedback-description"
              name="description"
              required
              rows={4}
              placeholder="What happened? What did you expect?"
            />
          </div>

          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Submitting..." : "Submit Feedback"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
