"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { KennelCard } from "@/components/kennels/KennelCard";

type Kennel = {
  id: string;
  slug: string;
  shortName: string;
  fullName: string;
  region: string;
  _count: { members: number };
};

interface KennelDirectoryProps {
  kennels: Kennel[];
}

export function KennelDirectory({ kennels }: KennelDirectoryProps) {
  const [search, setSearch] = useState("");

  const query = search.toLowerCase();
  const filtered = query
    ? kennels.filter(
        (k) =>
          k.shortName.toLowerCase().includes(query) ||
          k.fullName.toLowerCase().includes(query) ||
          k.region.toLowerCase().includes(query),
      )
    : kennels;

  // Group by region
  const grouped: Record<string, Kennel[]> = {};
  for (const kennel of filtered) {
    if (!grouped[kennel.region]) grouped[kennel.region] = [];
    grouped[kennel.region].push(kennel);
  }

  const regions = Object.keys(grouped).sort();

  return (
    <div className="mt-6 space-y-8">
      <Input
        placeholder="Search kennels..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {regions.length === 0 && (
        <p className="text-sm text-muted-foreground">No kennels found.</p>
      )}

      {regions.map((region) => (
        <div key={region}>
          <h2 className="mb-3 text-lg font-semibold">
            {region}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({grouped[region].length})
            </span>
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {grouped[region].map((kennel) => (
              <KennelCard key={kennel.id} kennel={kennel} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
