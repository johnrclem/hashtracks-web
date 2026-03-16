import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { formatTime } from "@/lib/format";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("id");
  if (!eventId) {
    return new Response("Missing id", { status: 400 });
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      date: true,
      title: true,
      runNumber: true,
      startTime: true,
      locationName: true,
      haresText: true,
      kennel: { select: { shortName: true, fullName: true, region: true } },
    },
  });

  if (!event) {
    return new Response("Not found", { status: 404 });
  }

  const dateStr = event.date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  const heading = event.title
    ? event.title
    : `Run${event.runNumber ? ` #${event.runNumber}` : ""}`;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0a0a0a",
          color: "#ffffff",
          fontFamily: "sans-serif",
          padding: "60px",
        }}
      >
        {/* Top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "40px",
          }}
        >
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#f97316",
              letterSpacing: "-0.02em",
            }}
          >
            HashTracks
          </div>
          <div
            style={{
              fontSize: 22,
              color: "#a1a1aa",
              backgroundColor: "#1c1c1e",
              padding: "8px 20px",
              borderRadius: "99px",
            }}
          >
            {event.kennel.region}
          </div>
        </div>

        {/* Kennel name */}
        <div
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: "#f97316",
            marginBottom: "12px",
          }}
        >
          {event.kennel.fullName}
        </div>

        {/* Event heading */}
        <div
          style={{
            fontSize: 52,
            fontWeight: 800,
            lineHeight: 1.1,
            marginBottom: "24px",
            maxWidth: "900px",
          }}
        >
          {heading}
        </div>

        {/* Details row */}
        <div
          style={{
            display: "flex",
            gap: "32px",
            fontSize: 26,
            color: "#a1a1aa",
            marginTop: "auto",
          }}
        >
          <span>{dateStr}</span>
          {event.startTime && <span>{formatTime(event.startTime)}</span>}
          {event.locationName && (
            <span style={{ maxWidth: "400px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {event.locationName}
            </span>
          )}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
