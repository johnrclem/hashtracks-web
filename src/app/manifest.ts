import type { MetadataRoute } from "next";

// Web App Manifest. Next.js serves this at /manifest.webmanifest and auto-wires
// the <link rel="manifest"> tag. The 512×512 icon is listed for both "any" and
// "maskable" purposes (Next's Manifest type takes one purpose per entry) so
// Android adaptive-icon launchers can crop it; the mark is a centered "H" that
// sits well inside the maskable safe zone (no edge content to clip).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HashTracks",
    short_name: "HashTracks",
    description:
      "Discover Hash House Harrier runs, track attendance, and find kennels worldwide.",
    start_url: "/",
    display: "standalone",
    background_color: "#141417",
    theme_color: "#f97316",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
