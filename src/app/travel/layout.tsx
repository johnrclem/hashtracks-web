import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Travel Mode — HashTracks",
  description:
    "Find hashes on the road. Search by destination and dates to discover confirmed events, likely trails, and hashing opportunities worldwide.",
  openGraph: {
    title: "Travel Mode — HashTracks",
    description: "Discover hashing opportunities at your travel destination.",
  },
};

export default function TravelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
