import { Metadata } from "next";
import { getRegionsWithKennels } from "./actions";
import { RegionManagement } from "@/components/admin/RegionManagement";

export const metadata: Metadata = { title: "Regions | Admin" };

export default async function AdminRegionsPage() {
  const regions = await getRegionsWithKennels();

  const serialized = regions.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    country: r.country,
    level: r.level,
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

  return <RegionManagement regions={serialized} />;
}
