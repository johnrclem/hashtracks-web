/** Client-safe weather display helpers (shared by EventCard + EventWeatherCard). */

export const CONDITION_EMOJIS: Record<string, string> = {
  CLEAR: "\u2600\uFE0F",
  MOSTLY_CLEAR: "\uD83C\uDF24\uFE0F",
  PARTLY_CLOUDY: "\u26C5",
  MOSTLY_CLOUDY: "\u2601\uFE0F",
  CLOUDY: "\u2601\uFE0F",
  WINDY: "\uD83D\uDCA8",
};

export function getConditionEmoji(conditionType: string): string {
  if (CONDITION_EMOJIS[conditionType]) return CONDITION_EMOJIS[conditionType];
  if (conditionType.includes("THUNDERSTORM") || conditionType === "THUNDERSHOWER") return "\u26C8\uFE0F";
  if (conditionType.includes("SNOW") || conditionType === "BLOWING_SNOW") return "\uD83C\uDF28\uFE0F";
  if (
    conditionType.includes("RAIN") ||
    conditionType.startsWith("SHOWERS") ||
    conditionType === "WIND_AND_RAIN"
  )
    return "\uD83C\uDF27\uFE0F";
  return "\uD83C\uDF21\uFE0F";
}

export function cToF(c: number): number {
  return Math.round(c * 9 / 5 + 32);
}
