import { sitemapSectionResponse } from "@/lib/sitemap";

// Per request, cached by the CDN: see src/app/sitemap.xml/route.ts.
export const dynamic = "force-dynamic";

export function GET() {
  return sitemapSectionResponse("static");
}
