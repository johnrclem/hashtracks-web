/**
 * Server-side weather utility using the Google Weather API.
 * Returns a daily forecast for a specific event date.
 * Results are cached for 30 minutes via Next.js fetch cache.
 */

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

/**
 * Fetch daily forecast for a given event date and location.
 * Returns null if the date is >10 days out, in the past, or the API fails.
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

  const url =
    `https://weather.googleapis.com/v1/forecast/days:lookup` +
    `?key=${apiKey}` +
    `&location.latitude=${lat}` +
    `&location.longitude=${lng}` +
    `&days=10`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 }, // 30-minute cache
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      forecastDays?: Array<{
        date?: { year: number; month: number; day: number };
        daytimeForecast?: {
          weatherCondition?: { type?: string; description?: { text?: string } };
          highTemperature?: { value?: number };
          precipitationProbability?: number;
        };
        nighttimeForecast?: {
          lowTemperature?: { value?: number };
        };
      }>;
    };

    const forecastDays = data.forecastDays ?? [];
    const match = forecastDays.find((day) => {
      if (!day.date) return false;
      const { year, month, day: d } = day.date;
      const paddedMonth = String(month).padStart(2, "0");
      const paddedDay = String(d).padStart(2, "0");
      return `${year}-${paddedMonth}-${paddedDay}` === targetDateStr;
    });

    if (!match) return null;

    const daytime = match.daytimeForecast;
    const nighttime = match.nighttimeForecast;

    const highTempC = daytime?.highTemperature?.value;
    const lowTempC = nighttime?.lowTemperature?.value;

    if (highTempC == null || lowTempC == null) return null;

    return {
      highTempC,
      lowTempC,
      condition: daytime?.weatherCondition?.description?.text ?? "Unknown",
      conditionType: daytime?.weatherCondition?.type ?? "",
      precipProbability: daytime?.precipitationProbability ?? 0,
    };
  } catch {
    return null;
  }
}
