/**
 * Server-side weather utility using the Google Weather API.
 * Returns a daily forecast for a specific event date.
 * Results are cached for 30 minutes via Next.js fetch cache.
 */

/** Daily weather forecast returned by the Google Weather API (Celsius-native). */
export interface DailyWeather {
  /** High temperature in Celsius — conversion to °F happens in the component */
  highTempC: number;
  /** Low temperature in Celsius */
  lowTempC: number;
  /** Human-readable condition, e.g. "Partly Cloudy" */
  condition: string;
  /** Enum string, e.g. "PARTLY_CLOUDY" — used for emoji mapping */
  conditionType: string;
  /** 0–100 percentage */
  precipProbability: number;
}

/** Shape of a single forecast day from the Google Weather API v1 response. */
interface GoogleWeatherForecastDay {
  displayDate?: { year: number; month: number; day: number };
  maxTemperature?: { degrees?: number };
  minTemperature?: { degrees?: number };
  daytimeForecast?: {
    weatherCondition?: { type?: string; description?: { text?: string } };
    precipitation?: { probability?: { percent?: number } };
  };
}

/** Top-level shape of the Google Weather API v1 days:lookup response. */
interface GoogleWeatherApiResponse {
  forecastDays?: GoogleWeatherForecastDay[];
}

/**
 * Fetch daily forecast for a given event date and location.
 * Returns null if the date is not found in the 10-day window or the API fails.
 * lat/lng should be valid coords — use REGION_CENTROIDS when precise coords are unavailable.
 */
export async function getEventDayWeather(
  lat: number,
  lng: number,
  eventDate: Date,
): Promise<DailyWeather | null> {
  const apiKey = process.env.GOOGLE_WEATHER_API_KEY;
  if (!apiKey) return null;

  const targetDateStr = eventDate.toISOString().slice(0, 10);

  // lat/lng are typed as numbers (from the DB), so no SSRF risk — the domain is hardcoded
  // and numeric parameters cannot contain path-traversal or injection payloads. // NOSONAR
  const url =
    `https://weather.googleapis.com/v1/forecast/days:lookup` +
    `?key=${apiKey}` +
    `&location.latitude=${lat}` +
    `&location.longitude=${lng}` +
    `&days=10`;

  try {
    const res = await fetch(url, { // NOSONAR - domain is hardcoded; lat/lng are DB-sourced numbers
      next: { revalidate: 1800 }, // 30-minute cache
    });

    if (!res.ok) return null;

    const data = (await res.json()) as GoogleWeatherApiResponse;

    const forecastDays = data.forecastDays ?? [];
    const match = forecastDays.find((day) => {
      if (!day.displayDate) return false;
      const { year, month, day: d } = day.displayDate;
      const paddedMonth = String(month).padStart(2, "0");
      const paddedDay = String(d).padStart(2, "0");
      return `${year}-${paddedMonth}-${paddedDay}` === targetDateStr;
    });

    if (!match) return null;

    const daytime = match.daytimeForecast;
    const highTempC = match.maxTemperature?.degrees;
    const lowTempC = match.minTemperature?.degrees;

    if (highTempC == null || lowTempC == null) return null;

    return {
      highTempC,
      lowTempC,
      condition: daytime?.weatherCondition?.description?.text ?? "Unknown",
      conditionType: daytime?.weatherCondition?.type ?? "",
      precipProbability: daytime?.precipitation?.probability?.percent ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Batch-fetch weather for a list of events within the 10-day forecast window.
 * Groups events by region centroid (or precise coords rounded to ~10km grid)
 * to minimize API calls — one call per unique location+date set.
 * Returns a map of eventId → DailyWeather.
 */
export async function getWeatherForEvents(
  events: Array<{
    id: string;
    date: string | Date;
    latitude?: number | null;
    longitude?: number | null;
    kennel: { region: string };
  }>,
): Promise<Record<string, DailyWeather>> {
  const apiKey = process.env.GOOGLE_WEATHER_API_KEY;
  if (!apiKey) return {};

  const now = new Date();
  const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() + tenDaysMs);

  // Filter to events within the 10-day forecast window
  const eligible = events.filter((e) => {
    const d = e.date instanceof Date ? e.date : new Date(e.date);
    return d >= now && d <= cutoff;
  });

  if (eligible.length === 0) return {};

  // Group by location key (region centroid or rounded coords) to deduplicate API calls.
  // Each unique location gets ONE API call (returns 10 days of forecasts),
  // then we match individual event dates from the response.
  const { getRegionCentroid } = await import("@/lib/region");

  interface LocationGroup {
    lat: number;
    lng: number;
    events: Array<{ id: string; dateStr: string }>;
  }

  const locationGroups = new Map<string, LocationGroup>();

  for (const event of eligible) {
    let lat: number | undefined;
    let lng: number | undefined;

    if (event.latitude != null && event.longitude != null) {
      // Round to ~10km grid to share API calls for nearby events
      lat = Math.round(event.latitude * 10) / 10;
      lng = Math.round(event.longitude * 10) / 10;
    } else {
      const centroid = getRegionCentroid(event.kennel.region);
      if (centroid) {
        lat = centroid.lat;
        lng = centroid.lng;
      }
    }

    if (lat == null || lng == null) continue;

    const key = `${lat},${lng}`;
    const d = event.date instanceof Date ? event.date : new Date(event.date);
    const dateStr = d.toISOString().slice(0, 10);

    const group = locationGroups.get(key);
    if (group) {
      group.events.push({ id: event.id, dateStr });
    } else {
      locationGroups.set(key, { lat, lng, events: [{ id: event.id, dateStr }] });
    }
  }

  // Fetch weather for each unique location (cap at 15 API calls)
  const result: Record<string, DailyWeather> = {};
  const entries = Array.from(locationGroups.values()).slice(0, 15);

  const fetches = entries.map(async (group) => {
    const url =
      `https://weather.googleapis.com/v1/forecast/days:lookup` +
      `?key=${apiKey}` +
      `&location.latitude=${group.lat}` +
      `&location.longitude=${group.lng}` +
      `&days=10`;

    try {
      const res = await fetch(url, { next: { revalidate: 1800 } });
      if (!res.ok) return;

      const data = (await res.json()) as GoogleWeatherApiResponse;
      const forecastDays = data.forecastDays ?? [];

      // Index forecast days by date string for O(1) lookup
      const daysByDate = new Map<string, GoogleWeatherForecastDay>();
      for (const day of forecastDays) {
        if (!day.displayDate) continue;
        const { year, month, day: d } = day.displayDate;
        const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        daysByDate.set(dateKey, day);
      }

      for (const event of group.events) {
        const match = daysByDate.get(event.dateStr);
        if (!match) continue;

        const daytime = match.daytimeForecast;
        const highTempC = match.maxTemperature?.degrees;
        const lowTempC = match.minTemperature?.degrees;
        if (highTempC == null || lowTempC == null) continue;

        result[event.id] = {
          highTempC,
          lowTempC,
          condition: daytime?.weatherCondition?.description?.text ?? "Unknown",
          conditionType: daytime?.weatherCondition?.type ?? "",
          precipProbability: daytime?.precipitation?.probability?.percent ?? 0,
        };
      }
    } catch {
      // Skip this location group on failure
    }
  });

  await Promise.all(fetches);

  return result;
}
