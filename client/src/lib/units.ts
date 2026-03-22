export type UnitSystem = "metric" | "imperial";

export function fmtTemp(c: number, units: UnitSystem): string {
  if (units === "imperial") return `${Math.round(c * 9 / 5 + 32)}°F`;
  return `${Math.round(c)}°C`;
}

export function fmtWind(kmh: number, units: UnitSystem): string {
  if (units === "imperial") return `${Math.round(kmh * 0.621)}mph`;
  return `${Math.round(kmh)}km/h`;
}

export function fmtRad(wm2: number): string {
  return `${Math.round(wm2)}W/m²`;
}

// Beaufort wind penalty thresholds are always in km/h internally —
// no need to convert the scoring logic, only the display.
