import { ImageResponse } from "next/og";

// iOS home-screen icon (180x180). Rounded-rect mask is applied by iOS; we paint
// the brand dark background edge-to-edge with the orange "H" mark.
export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 128,
          fontWeight: 800,
          letterSpacing: "-6px",
        }}
      >
        H
      </div>
    ),
    { ...size },
  );
}
