import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Misman · HashTracks",
};

export default function MismanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="space-y-6">{children}</div>;
}
