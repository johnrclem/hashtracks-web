import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { getRegionColor } from "@/lib/region";
import { formatDateLong } from "@/lib/format";
import { DISPLAYABLE_EVENT_NO_PARENT_WHERE } from "@/lib/event-filters";

// Must use nodejs runtime (not edge) because Prisma requires Node.js
export const runtime = "nodejs";
export const alt = "HashTracks Event";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function GenericCard() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#141417", color: "#ffffff", fontSize: 48 }}>
        HashTracks
      </div>
    ),
    { ...size },
  );
}

export default async function OgImage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  // Honor the same public-visibility contract as the hareline list: a polished,
  // crawlable card must never render for cancelled, private manual-entry,
  // non-canonical, or hidden-kennel events. `findFirst` (not `findUnique`) so
  // the predicates apply alongside the id; series children stay addressable.
  const event = await prisma.event.findFirst({
    where: { id: eventId, ...DISPLAYABLE_EVENT_NO_PARENT_WHERE },
    select: {
      date: true,
      title: true,
      runNumber: true,
      locationName: true,
      kennel: { select: { shortName: true, fullName: true, region: true } },
      hares: { select: { hareName: true }, take: 3 },
    },
  });

  // Outside the public contract (or missing) → generic card, never event detail.
  if (!event) {
    return GenericCard();
  }

  // Event.date is stored as UTC noon (timestamp-without-tz); formatDateLong
  // formats in UTC, matching the date the detail page itself renders.
  const dateStr = formatDateLong(event.date.toISOString());

  const accent = getRegionColor(event.kennel.region);
  const hares = event.hares.map((h) => h.hareName).join(", ");

  const subtitleParts: string[] = [];
  if (event.runNumber) subtitleParts.push(`Run #${event.runNumber}`);
  if (event.title) subtitleParts.push(event.title);
  const subtitle = subtitleParts.join(" · ");

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", backgroundColor: "#141417", padding: "60px 80px" }}>
        {/* Top accent line — region-tinted */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "6px", backgroundColor: accent }} />

        {/* Date */}
        <div style={{ fontSize: 26, color: accent, fontWeight: 600, marginBottom: "16px" }}>
          {dateStr}
        </div>

        {/* Kennel short name */}
        <div style={{ fontSize: 72, fontWeight: 800, color: "#ffffff", letterSpacing: "-2px", lineHeight: 1 }}>
          {event.kennel.shortName}
        </div>

        {/* Full name */}
        <div style={{ fontSize: 28, color: "#a1a1aa", marginTop: "12px" }}>
          {event.kennel.fullName}
        </div>

        {/* Run # / title */}
        {subtitle && (
          <div style={{ fontSize: 30, color: "#e4e4e7", marginTop: "24px" }}>
            {subtitle}
          </div>
        )}

        {/* Location + hares */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px", fontSize: 22, color: "#71717a" }}>
          {event.locationName && <span style={{ display: "flex" }}>📍 {event.locationName}</span>}
          {hares && <span style={{ display: "flex" }}>🐰 {hares}</span>}
        </div>

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
