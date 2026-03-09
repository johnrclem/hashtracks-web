"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uncancelEvent } from "@/app/admin/events/actions";

export function RestoreEventButton({ eventId }: { eventId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleRestore() {
    startTransition(async () => {
      const result = await uncancelEvent(eventId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Event restored");
      router.refresh();
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRestore}
      disabled={isPending}
    >
      {isPending ? "Restoring…" : "Restore Event"}
    </Button>
  );
}
