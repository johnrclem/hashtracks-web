import { ImageResponse } from "next/og";

// Dynamic app icon — orange "H" mark on the brand dark background, matching the
// OG cards. Next.js serves this at /icon and wires it into <head>.
export const runtime = "edge";
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#141417",
          color: "#f97316",
          fontSize: 360,
          fontWeight: 800,
          letterSpacing: "-20px",
        }}
      >
        H
      </div>
    ),
    { ...size },
  );
}
