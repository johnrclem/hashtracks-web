import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getEventDayWeather, getWeatherForEvents } from "./weather";

const MOCK_API_KEY = "test-api-key";

/** Build a minimal valid Google Weather API response for a given date. */
function buildWeatherResponse(
  dateStr: string,
  overrides?: {
    highTempC?: number;
    lowTempC?: number;
    conditionType?: string;
    conditionText?: string;
    precipProbability?: number;
  },
) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return {
    forecastDays: [
      {
        displayDate: { year, month, day },
        maxTemperature: { degrees: overrides?.highTempC ?? 20 },
        minTemperature: { degrees: overrides?.lowTempC ?? 12 },
        daytimeForecast: {
          weatherCondition: {
            type: overrides?.conditionType ?? "PARTLY_CLOUDY",
            description: { text: overrides?.conditionText ?? "Partly Cloudy" },
          },
          precipitation: { probability: { percent: overrides?.precipProbability ?? 10 } },
        },
      },
    ],
  };
}

describe("getEventDayWeather", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_WEATHER_API_KEY", MOCK_API_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns null when API key is not configured", async () => {
    vi.stubEnv("GOOGLE_WEATHER_API_KEY", ""); // clear the key
    const result = await getEventDayWeather(40.71, -74.01, new Date("2026-03-01"));
    expect(result).toBeNull();
  });

  it("returns null when fetch returns a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const result = await getEventDayWeather(40.71, -74.01, new Date("2026-03-01"));
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const result = await getEventDayWeather(40.71, -74.01, new Date("2026-03-01"));
    expect(result).toBeNull();
  });

  it("returns null when the target date is not in the response", async () => {
    const response = buildWeatherResponse("2026-03-05"); // different date
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    }));
    const result = await getEventDayWeather(40.71, -74.01, new Date("2026-03-01"));
    expect(result).toBeNull();
  });

  it("returns null when forecastDays is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ forecastDays: [] }),
    }));
    const result = await getEventDayWeather(40.71, -74.01, new Date("2026-03-01"));
    expect(result).toBeNull();
  });

  it("returns null when temperature values are missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        forecastDays: [
          {
            displayDate: { year: 2026, month: 3, day: 1 },
            maxTemperature: {}, // missing degrees
            minTemperature: {}, // missing degrees
          },
        ],
      }),
    }));
    const result = await getEventDayWeather(40.71, -74.01, new Date("2026-03-01"));
    expect(result).toBeNull();
  });

  it("returns parsed DailyWeather for a matching date", async () => {
    const response = buildWeatherResponse("2026-03-01", {
      highTempC: 18,
      lowTempC: 8,
      conditionType: "MOSTLY_CLOUDY",
      conditionText: "Mostly Cloudy",
      precipProbability: 35,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    }));
    const result = await getEventDayWeather(40.71, -74.01, new Date("2026-03-01T12:00:00Z"));
    expect(result).toEqual({
      highTempC: 18,
      lowTempC: 8,
      condition: "Mostly Cloudy",
      conditionType: "MOSTLY_CLOUDY",
      precipProbability: 35,
    });
  });

  it("handles single-digit month and day in date matching", async () => {
    const response = buildWeatherResponse("2026-03-07"); // month=3, day=7 (no leading zeros)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    }));
    const result = await getEventDayWeather(40.71, -74.01, new Date("2026-03-07T12:00:00Z"));
    expect(result).not.toBeNull();
    expect(result?.conditionType).toBe("PARTLY_CLOUDY");
  });

  it("defaults condition fields when API omits them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        forecastDays: [
          {
            displayDate: { year: 2026, month: 3, day: 1 },
            maxTemperature: { degrees: 15 },
            minTemperature: { degrees: 5 },
            // no daytimeForecast weatherCondition or precipitation
          },
        ],
      }),
    }));
    const result = await getEventDayWeather(40.71, -74.01, new Date("2026-03-01T12:00:00Z"));
    expect(result).toEqual({
      highTempC: 15,
      lowTempC: 5,
      condition: "Unknown",
      conditionType: "",
      precipProbability: 0,
    });
  });

  it("passes lat/lng as query parameters in the fetch URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(buildWeatherResponse("2026-03-01")),
    });
    vi.stubGlobal("fetch", mockFetch);
    await getEventDayWeather(51.51, -0.13, new Date("2026-03-01T12:00:00Z"));
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("location.latitude=51.51");
    expect(calledUrl).toContain("location.longitude=-0.13");
    expect(calledUrl).toContain("weather.googleapis.com");
  });

  it("attaches an AbortSignal so a hung upstream can't stall the SSR (#768)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(buildWeatherResponse("2026-03-01")),
    });
    vi.stubGlobal("fetch", mockFetch);
    await getEventDayWeather(51.51, -0.13, new Date("2026-03-01T12:00:00Z"));
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("getWeatherForEvents", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_WEATHER_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("attaches an AbortSignal to each batched fetch (#768)", async () => {
    // Pick a date inside the 10-day forecast window so the batch
    // actually issues a fetch. Anchor on today + 1d so the test stays
    // green regardless of when it runs.
    const tomorrow = new Date();
    tomorrow.setUTCHours(12, 0, 0, 0);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const dateStr = tomorrow.toISOString().slice(0, 10);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(buildWeatherResponse(dateStr)),
    });
    vi.stubGlobal("fetch", mockFetch);

    await getWeatherForEvents([
      {
        id: "evt-1",
        date: tomorrow,
        latitude: 51.5,
        longitude: -0.1,
        kennel: { region: "London" },
      },
    ]);

    expect(mockFetch).toHaveBeenCalled();
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
