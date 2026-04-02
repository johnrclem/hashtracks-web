import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/api/", "/misman/", "/sign-in/", "/sign-up/", "/invite/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
