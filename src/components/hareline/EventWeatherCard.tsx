"use client";

import type { DailyWeather } from "@/lib/weather";
import { useUnitsPreference } from "@/components/providers/units-preference-provider";
import { getConditionEmoji, cToF } from "@/lib/weather-display";

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
