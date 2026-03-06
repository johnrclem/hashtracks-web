import type { RegionLevel } from "@/lib/region";

/** Region data serialized from the Prisma regionRef relation for client components. */
export interface RegionData {
  slug: string;
  name: string;
  abbrev: string;
  level: RegionLevel;
  colorClasses: string;
  pinColor: string;
  centroidLat: number | null;
  centroidLng: number | null;
}

/** Prisma select clause to fetch RegionData from a regionRef relation. */
export const REGION_DATA_SELECT = {
  slug: true,
  name: true,
  abbrev: true,
  level: true,
  colorClasses: true,
  pinColor: true,
  centroidLat: true,
  centroidLng: true,
} as const;
