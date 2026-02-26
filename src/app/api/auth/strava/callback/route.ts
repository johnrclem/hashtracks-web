import { NextRequest, NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  exchangeStravaCode,
  getAppUrl,
  StravaAthleteLimitError,
} from "@/lib/strava/client";
import type { Prisma } from "@/generated/prisma/client";

const STATE_COOKIE = "strava_oauth_state";

/**
 * GET /api/auth/strava/callback — Strava OAuth callback handler.
 *
 * @remarks
 * This route uses `NextResponse.redirect()` instead of the standard
 * `{ data, error?, meta? }` JSON envelope because it is an OAuth callback:
 * the browser navigates here directly from Strava's authorization page, so
 * the response must redirect the user back to the app UI. Returning JSON
 * would leave the user stranded on a raw JSON page.
 *
 * 1. Handle user denial (error=access_denied)
 * 2. Validate CSRF state parameter against cookie
 * 3. Exchange authorization code for tokens
 * 4. Check for duplicate athlete (one Strava account per HashTracks user)
 * 5. Upsert StravaConnection
 * 6. Redirect to profile page with status query param
 */
export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  const searchParams = request.nextUrl.searchParams;

  // Handle user denial
  const error = searchParams.get("error");
  if (error) {
    const response = NextResponse.redirect(
      new URL("/profile?strava=denied", appUrl),
    );
    response.cookies.delete(STATE_COOKIE);
    return response;
  }

  // Validate CSRF state
  const state = searchParams.get("state");
  const storedState = request.cookies.get(STATE_COOKIE)?.value;

  if (!state || !storedState || state !== storedState) {
    return NextResponse.redirect(
      new URL("/profile?strava=error&reason=invalid_state", appUrl),
    );
  }

  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(
      new URL("/profile?strava=error&reason=no_code", appUrl),
    );
  }

  // Verify user is authenticated
  const user = await getOrCreateUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", appUrl));
  }

  try {
    // Exchange code for tokens
    const tokenData = await exchangeStravaCode(code);
    const athleteId = String(tokenData.athlete.id);

    // Check if this Strava athlete is already connected to another user
    const existingConnection = await prisma.stravaConnection.findUnique({
      where: { athleteId },
      select: { userId: true },
    });

    if (existingConnection && existingConnection.userId !== user.id) {
      const response = NextResponse.redirect(
        new URL("/profile?strava=error&reason=athlete_linked", appUrl),
      );
      response.cookies.delete(STATE_COOKIE);
      return response;
    }

    // Upsert StravaConnection (handles reconnect case)
    const connectionData = {
      athleteId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: new Date(tokenData.expires_at * 1000),
      athleteData: {
        firstname: tokenData.athlete.firstname,
        lastname: tokenData.athlete.lastname,
        profile: tokenData.athlete.profile,
      } as Prisma.InputJsonValue,
    };

    await prisma.stravaConnection.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...connectionData },
      update: connectionData,
    });

    // Clear state cookie and redirect to profile
    const response = NextResponse.redirect(
      new URL("/profile?strava=connected", appUrl),
    );
    response.cookies.delete(STATE_COOKIE);
    return response;
  } catch (err) {
    console.error("Strava OAuth callback error:", err);
    const reason =
      err instanceof StravaAthleteLimitError
        ? "athlete_limit"
        : "token_exchange";
    const response = NextResponse.redirect(
      new URL(`/profile?strava=error&reason=${reason}`, appUrl),
    );
    response.cookies.delete(STATE_COOKIE);
    return response;
  }
}
