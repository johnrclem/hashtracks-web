import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStravaAuthUrl } from "@/lib/strava/client";

const STATE_COOKIE = "strava_oauth_state";

/**
 * GET /api/auth/strava — Initiate Strava OAuth flow.
 *
 * 1. Verify user is authenticated
 * 2. Check if already connected → redirect to profile
 * 3. Generate CSRF state token, store in httpOnly cookie
 * 4. Redirect to Strava authorization URL
 */
export async function GET() {
  const user = await getOrCreateUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"));
  }

  // Check if user already has a Strava connection
  const existing = await prisma.stravaConnection.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (existing) {
    return NextResponse.redirect(
      new URL("/profile?strava=already_connected", appUrl),
    );
  }

  // Generate CSRF state parameter
  const state = randomBytes(32).toString("hex");
  const authUrl = getStravaAuthUrl(state);

  // Store state in httpOnly cookie for validation in callback
  const response = NextResponse.redirect(authUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return response;
}
