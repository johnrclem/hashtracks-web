import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/hareline", "/kennels", "/about", "/for-misman"],
        disallow: [
          "/admin",
          "/api",
          "/sign-in",
          "/sign-up",
          "/logbook",
          "/profile",
          "/misman",
          "/strava",
          "/feedback",
          "/invite",
        ],
      },
    ],
    sitemap: `${getBaseUrl()}/sitemap.xml`,
  };
}
