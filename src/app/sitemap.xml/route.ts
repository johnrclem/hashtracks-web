import { buildSitemapIndexXml, SITEMAP_HEADERS } from "@/lib/sitemap";
import { getCanonicalSiteUrl } from "@/lib/site-url";

// Rendered per request and cached by the CDN (SITEMAP_HEADERS), never
// prerendered at build: a build-time copy is what froze the old sitemap.
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(buildSitemapIndexXml(getCanonicalSiteUrl()), { headers: SITEMAP_HEADERS });
}
