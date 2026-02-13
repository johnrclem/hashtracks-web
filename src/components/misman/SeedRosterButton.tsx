"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { seedRosterFromHares } from "@/app/misman/[slug]/history/actions";

interface SeedRosterButtonProps {
  kennelId: string;
}

export function SeedRosterButton({ kennelId }: SeedRosterButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSeed() {
    if (
      !confirm(
        "This will scan hare data from the past year and add any new names to the roster. Continue?",
      )
    )
      return;

    startTransition(async () => {
      const result = await seedRosterFromHares(kennelId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(result.message);
        router.refresh();
      }
    });
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleSeed}
      disabled={isPending}
    >
      {isPending ? "Seeding..." : "Seed from Hares"}
    </Button>
  );
}
