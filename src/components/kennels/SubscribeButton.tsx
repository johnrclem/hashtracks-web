"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { subscribeToKennel, unsubscribeFromKennel } from "@/app/kennels/actions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface SubscribeButtonProps {
  kennelId: string;
  isSubscribed: boolean;
  isAuthenticated: boolean;
}

export function SubscribeButton({
  kennelId,
  isSubscribed,
  isAuthenticated,
}: SubscribeButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (!isAuthenticated) {
    return (
      <Button variant="outline" size="sm" asChild>
        <a href="/sign-in">Sign in to subscribe</a>
      </Button>
    );
  }

  function handleClick() {
    startTransition(async () => {
      const action = isSubscribed ? unsubscribeFromKennel : subscribeToKennel;
      const result = await action(kennelId);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(isSubscribed ? "Unsubscribed" : "Subscribed!");
      }
      router.refresh();
    });
  }

  return (
    <Button
      variant={isSubscribed ? "outline" : "default"}
      size="sm"
      onClick={handleClick}
      disabled={isPending}
    >
      {isPending
        ? "..."
        : isSubscribed
          ? "Unsubscribe"
          : "Subscribe"}
    </Button>
  );
}
