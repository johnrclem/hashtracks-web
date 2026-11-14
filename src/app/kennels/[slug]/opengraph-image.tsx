import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { getKennelState, KENNEL_EVIDENCE_SELECT } from "@/lib/kennel-status";
import { formatSchedule } from "@/lib/format";
import { SCHEDULE_RULES_SELECT } from "@/lib/schedule-season";

// Must use nodejs runtime (not edge) because Prisma requires Node.js
export const runtime = "nodejs";
export const alt = "HashTracks Kennel";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    select: {
      shortName: true,
      fullName: true,
      region: true,
      ...KENNEL_EVIDENCE_SELECT,
      scheduleDayOfWeek: true,
      scheduleTime: true,
      scheduleFrequency: true,
      scheduleRules: SCHEDULE_RULES_SELECT,
      isHidden: true,
    },
  });

  if (!kennel || kennel.isHidden) {
    return new ImageResponse(
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#141417", color: "#ffffff", fontSize: 48 }}>
        HashTracks
      </div>,
      { ...size },
    );
  }

  const state = getKennelState(kennel);
  const STATUS_LABELS = {
    running: "Running",
    quiet: "Quiet lately",
    "not-seen": "No recent runs seen",
    stopped: "Stopped",
  } as const;
  const STATUS_COLORS = {
    running: "#4ade80",
    quiet: "#facc15",
    "not-seen": "#71717a",
    stopped: "#f87171",
  } as const;
  const statusText = STATUS_LABELS[state];
  const statusColor = STATUS_COLORS[state];
  const schedule = formatSchedule(kennel) ?? "";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", backgroundColor: "#141417", padding: "60px 80px" }}>
        {/* Top accent line */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "4px", background: "linear-gradient(90deg, #f97316, #fb923c, #fdba74)" }} />

        {/* Kennel name */}
        <div style={{ fontSize: 72, fontWeight: 800, color: "#ffffff", letterSpacing: "-2px", lineHeight: 1 }}>
          {kennel.shortName}
        </div>

        {/* Full name */}
        <div style={{ fontSize: 28, color: "#a1a1aa", marginTop: "12px" }}>
          {kennel.fullName}
        </div>

        {/* Region + schedule */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "24px", fontSize: 22, color: "#71717a" }}>
          <span>{kennel.region}</span>
          {schedule && <span style={{ display: "flex" }}>· {schedule}</span>}
        </div>

        {/* Activity status */}
        {statusText && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "16px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: statusColor }} />
            <span style={{ fontSize: 20, color: statusColor }}>{statusText}</span>
          </div>
        )}

        {/* Footer */}
        <div style={{ position: "absolute", bottom: "40px", display: "flex", alignItems: "center", gap: "12px", fontSize: 18, color: "#71717a" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#f97316" }} />
          {(process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz").replace(/^https?:\/\//, "")}
        </div>
      </div>
    ),
    { ...size },
  );
}
