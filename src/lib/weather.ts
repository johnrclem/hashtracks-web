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
