// Strava API response types

export interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix seconds
  athlete: {
    id: number;
    firstname: string;
    lastname: string;
    profile: string; // Profile pic URL
  };
}

export interface StravaApiActivity {
  id: number;
  name: string;
  sport_type: string; // Use sport_type, NOT deprecated "type" field
  start_date_local: string; // FAKE Z suffix — extract as string, never parse!
  distance: number; // meters
  moving_time: number; // seconds
  start_latlng: [number, number] | null;
  timezone: string;
  map: { summary_polyline: string } | null;
}

// Parsed/cleaned types for internal use
export interface ParsedStravaActivity {
  stravaActivityId: string; // Converted to string (avoids BigInt serialization)
  name: string;
  sportType: string;
  dateLocal: string; // "YYYY-MM-DD"
  timeLocal: string | null; // "HH:MM"
  distanceMeters: number;
  movingTimeSecs: number;
  startLat: number | null;
  startLng: number | null;
  timezone: string | null;
}

/** Shape returned to the UI for the "Pick from Strava" dropdown. */
export interface StravaActivityOption {
  id: string; // StravaActivity.id (cuid)
  stravaActivityId: string;
  name: string;
  sportType: string;
  dateLocal: string;
  timeLocal: string | null;
  distanceMeters: number;
  movingTimeSecs: number;
}
