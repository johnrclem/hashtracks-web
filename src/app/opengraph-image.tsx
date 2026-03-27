import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "HashTracks — Find your next trail before the beer gets warm";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#141417",
          fontFamily: "Inter, system-ui, sans-serif",
          padding: "60px 80px",
        }}
      >
        {/* Subtle top accent line */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "4px",
            background: "linear-gradient(90deg, #f97316, #fb923c, #fdba74)",
          }}
        />

        {/* Title */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "24px",
          }}
        >
          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              color: "#ffffff",
              letterSpacing: "-2px",
              lineHeight: 1,
            }}
          >
            HashTracks
          </div>

          {/* Tagline with orange highlight */}
          <div
            style={{
              display: "flex",
              fontSize: 28,
              color: "#a1a1aa",
              textAlign: "center",
              lineHeight: 1.4,
            }}
          >
            Find your next
            <span
              style={{
                position: "relative",
                marginLeft: "8px",
                marginRight: "8px",
                color: "#ffffff",
              }}
            >
              trail
              <span
                style={{
                  position: "absolute",
                  bottom: "2px",
                  left: 0,
                  right: 0,
                  height: "10px",
                  backgroundColor: "rgba(249, 115, 22, 0.4)",
                  borderRadius: "3px",
                }}
              />
            </span>
            before the beer gets warm
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            position: "absolute",
            bottom: "40px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            fontSize: 18,
            color: "#71717a",
          }}
        >
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: "#f97316",
            }}
          />
          hashtracks.com
        </div>
      </div>
    ),
    { ...size },
  );
}
