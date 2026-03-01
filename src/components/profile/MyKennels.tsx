"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { unsubscribeFromKennel } from "@/app/kennels/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { toast } from "sonner";

interface MyKennelsProps {
  kennels: {
    kennelId: string;
    kennel: {
      slug: string;
      shortName: string;
      fullName: string;
      region: string;
    };
  }[];
}

export function MyKennels({ kennels }: MyKennelsProps) {
  if (kennels.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        You haven&apos;t subscribed to any kennels yet.{" "}
        <Link href="/kennels" className="text-primary hover:underline">
          Browse the directory
        </Link>{" "}
        to find your home kennels.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {kennels.map((uk) => (
        <KennelRow key={uk.kennelId} userKennel={uk} />
      ))}
    </div>
  );
}

function KennelRow({
  userKennel,
}: {
  userKennel: MyKennelsProps["kennels"][number];
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { kennel } = userKennel;

  function handleUnsubscribe() {
    startTransition(async () => {
      const result = await unsubscribeFromKennel(userKennel.kennelId);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`Unsubscribed from ${kennel.shortName}`);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between rounded-md border px-4 py-3">
      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={`/kennels/${kennel.slug}`}
              className="font-medium hover:underline"
            >
              {kennel.shortName}
            </Link>
          </TooltipTrigger>
          <TooltipContent>{kennel.fullName}</TooltipContent>
        </Tooltip>
        <Badge variant="secondary" className="text-xs">
          {kennel.region}
        </Badge>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleUnsubscribe}
        disabled={isPending}
      >
        {isPending ? "..." : "Unsubscribe"}
      </Button>
    </div>
  );
}
