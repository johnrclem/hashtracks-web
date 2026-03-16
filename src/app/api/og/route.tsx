import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0a",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 80,
            fontWeight: 800,
            color: "#f97316",
            letterSpacing: "-0.03em",
            marginBottom: "24px",
          }}
        >
          HashTracks
        </div>
        <div
          style={{
            fontSize: 32,
            color: "#a1a1aa",
            textAlign: "center",
            maxWidth: "700px",
            lineHeight: 1.4,
          }}
        >
          Discover hash runs, track attendance, explore 176+ kennels worldwide
        </div>
        <div
          style={{
            display: "flex",
            gap: "40px",
            marginTop: "48px",
            fontSize: 24,
            color: "#71717a",
          }}
        >
          <span>92 live sources</span>
          <span>176+ kennels</span>
          <span>15 regions</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
