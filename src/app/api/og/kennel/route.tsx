import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return new Response("Missing slug", { status: 400 });
  }

  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    select: {
      shortName: true,
      fullName: true,
      region: true,
      description: true,
      scheduleDayOfWeek: true,
      scheduleFrequency: true,
      foundedYear: true,
      _count: { select: { events: true, members: true } },
    },
  });

  if (!kennel) {
    return new Response("Not found", { status: 404 });
  }

  const schedule = kennel.scheduleDayOfWeek
    ? `${kennel.scheduleFrequency ?? "Regular"} — ${kennel.scheduleDayOfWeek}s`
    : null;

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
            {kennel.region}
          </div>
        </div>

        {/* Short name */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            marginBottom: "16px",
          }}
        >
          {kennel.shortName}
        </div>

        {/* Full name */}
        <div
          style={{
            fontSize: 32,
            color: "#a1a1aa",
            marginBottom: "24px",
          }}
        >
          {kennel.fullName}
        </div>

        {/* Description or schedule */}
        {kennel.description && (
          <div
            style={{
              fontSize: 24,
              color: "#d4d4d8",
              maxWidth: "800px",
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              // @ts-expect-error -- OG image renderer supports this non-standard prop
              WebkitLineClamp: 2,
              // @ts-expect-error -- OG image renderer supports this non-standard prop
              WebkitBoxOrient: "vertical",
            }}
          >
            {kennel.description}
          </div>
        )}

        {/* Bottom stats */}
        <div
          style={{
            display: "flex",
            gap: "40px",
            fontSize: 24,
            color: "#a1a1aa",
            marginTop: "auto",
          }}
        >
          {schedule && <span>{schedule}</span>}
          <span>{kennel._count.events} events</span>
          <span>{kennel._count.members} members</span>
          {kennel.foundedYear && <span>Est. {kennel.foundedYear}</span>}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
