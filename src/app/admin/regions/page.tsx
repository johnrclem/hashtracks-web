import { Metadata } from "next";
import { getRegionsWithKennels } from "./actions";
import { RegionTable } from "@/components/admin/RegionTable";
import { RegionSuggestionsPanel } from "@/components/admin/RegionSuggestionsPanel";

export const metadata: Metadata = { title: "Regions | Admin" };

export default async function AdminRegionsPage() {
  const regions = await getRegionsWithKennels();

  const serialized = regions.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    country: r.country,
    timezone: r.timezone,
    abbrev: r.abbrev,
    colorClasses: r.colorClasses,
    pinColor: r.pinColor,
    centroidLat: r.centroidLat,
    centroidLng: r.centroidLng,
    parentId: r.parentId,
    parentName: r.parent?.name ?? null,
    kennels: r.kennels,
    childCount: r.children.length,
  }));

  return (
    <div className="space-y-6">
      <RegionTable regions={serialized} />
      <RegionSuggestionsPanel />
    </div>
  );
}
