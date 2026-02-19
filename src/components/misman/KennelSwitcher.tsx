"use client";

import { useRouter, usePathname } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface KennelOption {
  id: string;
  shortName: string;
  fullName: string;
  slug: string;
}

interface KennelSwitcherProps {
  currentKennel: { shortName: string; fullName: string; slug: string };
  kennels: KennelOption[];
}

export function KennelSwitcher({
  currentKennel,
  kennels,
}: KennelSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();

  // If user only has one kennel, show plain heading
  if (kennels.length <= 1) {
    return <h1 className="text-2xl font-bold">{currentKennel.shortName}</h1>;
  }

  function handleChange(slug: string) {
    // Preserve the current tab (attendance/roster/history)
    const segments = pathname.split("/");
    // pathname is /misman/[slug]/[tab]/...
    const tab = segments[3] || "attendance";
    router.push(`/misman/${slug}/${tab}`);
  }

  return (
    <Select value={currentKennel.slug} onValueChange={handleChange}>
      <SelectTrigger className="w-fit text-2xl font-bold border-none shadow-none px-0 h-auto focus-visible:ring-0 [&>svg]:ml-1">
        <span>{currentKennel.shortName}</span>
      </SelectTrigger>
      <SelectContent>
        {kennels.map((k) => (
          <SelectItem key={k.id} value={k.slug}>
            <span className="font-medium">{k.shortName}</span>
            <span className="ml-1.5 text-sm font-normal text-muted-foreground">
              — {k.fullName}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
