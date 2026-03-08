"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { backfillKennelCoords } from "@/app/admin/kennels/backfill-action";

interface BackfillCoordsButtonProps {
  missingCount: number;
}

export function BackfillCoordsButton({ missingCount }: Readonly<BackfillCoordsButtonProps>) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (missingCount === 0) return null;

  function handleClick() {
    startTransition(async () => {
      const { error, result } = await backfillKennelCoords();
      if (error) {
        toast.error(error);
        return;
      }
      if (result) {
        const parts: string[] = [];
        if (result.fromDiscovery > 0) parts.push(`${result.fromDiscovery} from discovery`);
        if (result.geocoded > 0) parts.push(`${result.geocoded} geocoded`);
        if (result.failed.length > 0) parts.push(`${result.failed.length} failed`);
        toast.success(`Backfill complete: ${parts.join(", ")}`);
      }
      router.refresh();
    });
  }

  return (
    <Button size="sm" variant="outline" onClick={handleClick} disabled={isPending}>
      <MapPin className="mr-1 h-3.5 w-3.5" />
      {isPending ? "Filling coords..." : `Fill ${missingCount} Missing Coords`}
    </Button>
  );
}
