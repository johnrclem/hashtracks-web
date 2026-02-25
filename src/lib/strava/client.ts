import { prisma } from "@/lib/db";
import type {
  StravaTokenResponse,
  StravaApiActivity,
  ParsedStravaActivity,
} from "./types";

// ── Configuration ──

const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_API_BASE = "https://www.strava.com/api/v3";
const STRAVA_DEAUTH_URL = "https://www.strava.com/oauth/deauthorize";

function getClientId(): string {
  const id = process.env.STRAVA_CLIENT_ID;
  if (!id) throw new Error("STRAVA_CLIENT_ID is not set");
  return id;
}

function getClientSecret(): string {
  const secret = process.env.STRAVA_CLIENT_SECRET;
  if (!secret) throw new Error("STRAVA_CLIENT_SECRET is not set");
  return secret;
}

function getRedirectUri(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${appUrl}/api/auth/strava/callback`;
}

// ── OAuth ──

/** Build the Strava OAuth authorization URL. */
export function getStravaAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: "activity:read_all",
    state,
  });
  return `${STRAVA_AUTH_URL}?${params.toString()}`;
}

/** Exchange an authorization code for tokens (initial OAuth). */
export async function exchangeStravaCode(
  code: string,
): Promise<StravaTokenResponse> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<StravaTokenResponse>;
}

/** Refresh an expired access token using the refresh token. */
export async function refreshStravaToken(
  refreshToken: string,
): Promise<StravaTokenResponse> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava token refresh failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<StravaTokenResponse>;
}

/**
 * Get a valid access token, auto-refreshing if within 30 min of expiry.
 * Updates the DB row when refresh occurs.
 */
export async function getValidAccessToken(connection: {
  id: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}): Promise<{ accessToken: string; refreshed: boolean }> {
  const now = new Date();
  const thirtyMinFromNow = new Date(now.getTime() + 30 * 60 * 1000);

  if (connection.expiresAt > thirtyMinFromNow) {
    return { accessToken: connection.accessToken, refreshed: false };
  }

  // Token is expired or expiring soon — refresh
  const tokenData = await refreshStravaToken(connection.refreshToken);

  await prisma.stravaConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: new Date(tokenData.expires_at * 1000),
    },
  });

  return { accessToken: tokenData.access_token, refreshed: true };
}

/** Revoke access on Strava's end (required on disconnect per API agreement). */
export async function deauthorizeStrava(accessToken: string): Promise<void> {
  const res = await fetch(STRAVA_DEAUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ access_token: accessToken }),
  });

  // 401 means token is already invalid — treat as success
  if (!res.ok && res.status !== 401) {
    const text = await res.text();
    throw new Error(`Strava deauthorization failed (${res.status}): ${text}`);
  }
}

// ── Activities ──

/**
 * Fetch activities from the Strava API.
 * `after`/`before` are Unix seconds. Handles pagination (max 200/page).
 */
export async function fetchStravaActivities(
  accessToken: string,
  after: number,
  before: number,
): Promise<StravaApiActivity[]> {
  const allActivities: StravaApiActivity[] = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const params = new URLSearchParams({
      after: String(after),
      before: String(before),
      per_page: String(perPage),
      page: String(page),
    });

    const res = await fetch(
      `${STRAVA_API_BASE}/athlete/activities?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (res.status === 429) {
      throw new Error(
        "Strava rate limit exceeded. Please try again in a few minutes.",
      );
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Strava activity fetch failed (${res.status}): ${text}`,
      );
    }

    const activities = (await res.json()) as StravaApiActivity[];
    allActivities.push(...activities);

    // If we got fewer than perPage, we've reached the end
    if (activities.length < perPage) break;
    page++;
  }

  return allActivities;
}

// ── Parsing ──

/**
 * Parse a raw Strava API activity into our internal format.
 *
 * CRITICAL: Extracts dateLocal/timeLocal as STRINGS from start_date_local.
 * Strava's start_date_local has a fake "Z" suffix — it's actually local time,
 * NOT UTC. Never parse through new Date().
 *
 * Handles privacy zones: [0, 0] or null → null coords.
 */
export function parseStravaActivity(
  raw: StravaApiActivity,
): ParsedStravaActivity {
  // Extract date/time as strings — NEVER use new Date() on start_date_local
  const dateLocal = raw.start_date_local.substring(0, 10); // "YYYY-MM-DD"
  const timeLocal = raw.start_date_local.substring(11, 16); // "HH:MM"

  // Handle privacy zones: null or [0, 0] → null
  let startLat: number | null = null;
  let startLng: number | null = null;
  if (
    raw.start_latlng &&
    raw.start_latlng.length === 2 &&
    !(raw.start_latlng[0] === 0 && raw.start_latlng[1] === 0)
  ) {
    startLat = raw.start_latlng[0];
    startLng = raw.start_latlng[1];
  }

  return {
    stravaActivityId: String(raw.id),
    name: raw.name,
    sportType: raw.sport_type,
    dateLocal,
    timeLocal: timeLocal || null,
    distanceMeters: raw.distance,
    movingTimeSecs: raw.moving_time,
    startLat,
    startLng,
    timezone: raw.timezone || null,
  };
}

/** Build the canonical Strava activity URL. */
export function buildStravaUrl(stravaActivityId: string): string {
  return `https://www.strava.com/activities/${stravaActivityId}`;
}

/** Validate and extract Strava activity ID from a URL. */
export function extractStravaActivityId(url: string): string | null {
  const match = url.match(/strava\.com\/activities\/(\d+)/i);
  return match ? match[1] : null;
}
