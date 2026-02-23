"use client";

import type { DailyWeather } from "@/lib/weather";
import { useUnitsPreference } from "@/components/providers/units-preference-provider";

const CONDITION_EMOJIS: Record<string, string> = {
  CLEAR: "☀️",
  MOSTLY_CLEAR: "🌤️",
  PARTLY_CLOUDY: "⛅",
  MOSTLY_CLOUDY: "☁️",
  CLOUDY: "☁️",
  WINDY: "💨",
};

function getConditionEmoji(conditionType: string): string {
  if (CONDITION_EMOJIS[conditionType]) return CONDITION_EMOJIS[conditionType];
  if (conditionType.includes("THUNDERSTORM") || conditionType === "THUNDERSHOWER") return "⛈️";
  if (conditionType.includes("SNOW") || conditionType === "BLOWING_SNOW") return "🌨️";
  if (
    conditionType.includes("RAIN") ||
    conditionType.startsWith("SHOWERS") ||
    conditionType === "WIND_AND_RAIN"
  )
    return "🌧️";
  return "🌡️";
}

function cToF(c: number): number {
  return Math.round(c * 9 / 5 + 32);
}

interface EventWeatherCardProps {
  weather: DailyWeather;
}

export function EventWeatherCard({ weather }: EventWeatherCardProps) {
  const { tempUnit } = useUnitsPreference();

  const emoji = getConditionEmoji(weather.conditionType);
  const unit = tempUnit === "IMPERIAL" ? "°F" : "°C";
  const high = tempUnit === "IMPERIAL" ? cToF(weather.highTempC) : Math.round(weather.highTempC);
  const low = tempUnit === "IMPERIAL" ? cToF(weather.lowTempC) : Math.round(weather.lowTempC);

  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">Weather</dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
        <span suppressHydrationWarning>
          {emoji} {weather.condition}
        </span>
        <span className="text-muted-foreground" suppressHydrationWarning>
          {high}{unit} / {low}{unit}
        </span>
        {weather.precipProbability >= 20 && (
          <span className="text-muted-foreground">
            {weather.precipProbability}% precip
          </span>
        )}
      </dd>
    </div>
  );
}
