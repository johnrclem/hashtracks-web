import type { MetadataRoute } from "next";

// Web App Manifest. Next.js serves this at /manifest.webmanifest and auto-wires
// the <link rel="manifest"> tag. Icon routes (icon.tsx / apple-icon.tsx) are
// referenced via the file-based metadata convention, but we also list a maskable
// icon here so Android home-screen installs get a properly cropped mark.
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
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
