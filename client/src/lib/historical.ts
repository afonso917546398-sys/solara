import { calcHourScore } from "./weather";

export interface DayAccuracy {
  date: string;         // yyyy-mm-dd
  forecastScore: number;
  actualScore: number;
  delta: number;        // actual - forecast (positive = under-predicted, negative = over-predicted)
  cloudActual: number;
  uvActual: number;
  radActual: number;
  windActual: number;
  tempActual: number;
}

/**
 * Fetch past 7 days of actual weather data from Open-Meteo historical API
 * and compute what the score would have been using real measurements.
 */
export async function fetchActualScores(
  lat: number,
  lon: number
): Promise<DayAccuracy[]> {
  // Build date range: 7 days ago to yesterday
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() - 1);
  const start = new Date(today);
  start.setDate(start.getDate() - 7);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", lat.toString());
  url.searchParams.set("longitude", lon.toString());
  url.searchParams.set("start_date", fmt(start));
  url.searchParams.set("end_date", fmt(end));
  url.searchParams.set("hourly", [
    "cloud_cover",
    "uv_index",
    "direct_radiation",
    "wind_speed_10m",
    "apparent_temperature",
    "temperature_2m",
    "weather_code",
    "is_day",
  ].join(","));
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Historical API error");
  const data = await res.json();

  const { hourly } = data;
  const times: string[] = hourly.time;

  // Group by date and compute daily score from actuals
  const dayMap = new Map<string, number[]>();

  times.forEach((t, i) => {
    const date = t.split("T")[0];
    const hour = parseInt(t.split("T")[1].slice(0, 2), 10);

    const hBase = {
      hour,
      timeLabel: `${String(hour).padStart(2, "0")}:00`,
      cloudCover: hourly.cloud_cover[i] ?? 100,
      uvIndex: hourly.uv_index[i] ?? 0,
      temperature: hourly.temperature_2m[i] ?? 10,
      apparentTemp: hourly.apparent_temperature[i] ?? 10,
      directRadiation: hourly.direct_radiation[i] ?? 0,
      windSpeed: Math.round(hourly.wind_speed_10m[i] ?? 0),
      isDay: hourly.is_day[i] ?? 0,
      weatherCode: hourly.weather_code[i] ?? 0,
    };

    const score = calcHourScore(hBase);
    if (!dayMap.has(date)) dayMap.set(date, []);
    if (hBase.isDay) dayMap.get(date)!.push(score);
  });

  // Compute daily actual score (average of daylight hours, weighted to peak)
  const results: DayAccuracy[] = [];

  for (const [date, scores] of dayMap.entries()) {
    if (scores.length === 0) continue;

    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const peak = Math.max(...scores);
    const actualScore = Math.round(avg * 0.5 + peak * 0.5);

    // Get representative afternoon values for display
    const idx = times.findIndex(t => t.startsWith(date) && t.includes("T13:"));
    const cloudActual = idx >= 0 ? Math.round(hourly.cloud_cover[idx] ?? 0) : 0;
    const uvActual = idx >= 0 ? Math.round((hourly.uv_index[idx] ?? 0) * 10) / 10 : 0;
    const radActual = idx >= 0 ? Math.round(hourly.direct_radiation[idx] ?? 0) : 0;
    const windActual = idx >= 0 ? Math.round(hourly.wind_speed_10m[idx] ?? 0) : 0;
    const tempActual = idx >= 0 ? Math.round(hourly.apparent_temperature[idx] ?? 0) : 0;

    results.push({
      date,
      forecastScore: 0, // filled in by UI from check-in log if available
      actualScore,
      delta: 0,
      cloudActual,
      uvActual,
      radActual,
      windActual,
      tempActual,
    });
  }

  return results.sort((a, b) => a.date.localeCompare(b.date));
}
