"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { backfillEventCities } from "@/app/admin/events/backfill-city-action";

interface BackfillCitiesButtonProps {
  missingCount: number;
}

export function BackfillCitiesButton({ missingCount }: Readonly<BackfillCitiesButtonProps>) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (missingCount === 0) return null;

  function handleClick() {
    startTransition(async () => {
      const { error, result } = await backfillEventCities();
      if (error) {
        toast.error(error);
        return;
      }
      if (result) {
        const parts: string[] = [];
        if (result.filled > 0) parts.push(`${result.filled} filled`);
        if (result.failed > 0) parts.push(`${result.failed} failed`);
        toast.success(`Backfill complete: ${parts.join(", ")}`);
      }
      router.refresh();
    });
  }

  return (
    <Button size="sm" variant="outline" onClick={handleClick} disabled={isPending}>
      <MapPin className="mr-1 h-3.5 w-3.5" />
      {isPending ? "Filling cities..." : `Fill ${missingCount} Missing Cities`}
    </Button>
  );
}
