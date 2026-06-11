import { calcHourScore } from "./weather";

export interface HourDetail {
  hour: number;
  // Forecast (model) values
  fRad: number;
  fCloud: number;
  fUV: number;
  fTemp: number;
  fWind: number;
  fScore: number;
  // Actual (archive reanalysis) values
  aRad: number;
  aCloud: number;
  aUV: number;
  aTemp: number;
  aWind: number;
  aScore: number;
}

export interface DayAccuracy {
  date: string;       // yyyy-mm-dd — weekday is formatted at render time
  bestHour: HourDetail;
}

function fmt(d: Date) { return d.toISOString().slice(0, 10); }

/**
 * Fetch past 7 days: forecast model values (past_days) + archive reanalysis.
 * For each day find the hour with the highest actual score and return
 * a side-by-side comparison of all variables at that hour.
 */
export async function fetchActualScores(
  lat: number,
  lon: number
): Promise<DayAccuracy[]> {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() - 1);          // yesterday
  const start = new Date(today);
  start.setDate(start.getDate() - 7);      // 7 days ago

  const vars = [
    "direct_radiation",
    "cloud_cover",
    "uv_index",
    "apparent_temperature",
    "wind_speed_10m",
    "weather_code",
    "is_day",
  ].join(",");

  // ── Forecast API (past_days) — model forecast values ──────────────
  const fUrl = new URL("https://api.open-meteo.com/v1/forecast");
  fUrl.searchParams.set("latitude", lat.toString());
  fUrl.searchParams.set("longitude", lon.toString());
  fUrl.searchParams.set("hourly", vars);
  fUrl.searchParams.set("past_days", "7");
  fUrl.searchParams.set("forecast_days", "1");
  fUrl.searchParams.set("timezone", "auto");

  // ── Archive API — actual reanalysis values ──────────────────────────
  const aUrl = new URL("https://archive-api.open-meteo.com/v1/archive");
  aUrl.searchParams.set("latitude", lat.toString());
  aUrl.searchParams.set("longitude", lon.toString());
  aUrl.searchParams.set("start_date", fmt(start));
  aUrl.searchParams.set("end_date", fmt(end));
  aUrl.searchParams.set("hourly", vars);
  aUrl.searchParams.set("timezone", "auto");

  const [fRes, aRes] = await Promise.all([fetch(fUrl.toString()), fetch(aUrl.toString())]);
  if (!fRes.ok || !aRes.ok) throw new Error("Historical API error");
  const [fData, aData] = await Promise.all([fRes.json(), aRes.json()]);

  // ── Index both by "yyyy-mm-ddThh" ──────────────────────────────────
  function indexByHour(data: any) {
    const map = new Map<string, number>();
    (data.hourly.time as string[]).forEach((t, i) => map.set(t, i));
    return { map, h: data.hourly };
  }

  const f = indexByHour(fData);
  const a = indexByHour(aData);

  // ── For each date in range, find best actual hour ───────────────────
  const results: DayAccuracy[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = fmt(d);

    // Collect all daylight hours with actual scores
    const hours: Array<{ hour: number; aScore: number }> = [];
    for (let h = 0; h < 24; h++) {
      const key = `${dateStr}T${String(h).padStart(2, '0')}:00`;
      const ai = a.map.get(key);
      if (ai === undefined) continue;
      if (!(a.h.is_day[ai])) continue;

      const aHour = {
        hour: h,
        timeLabel: `${String(h).padStart(2, '0')}:00`,
        directRadiation: a.h.direct_radiation[ai] ?? 0,
        cloudCover: a.h.cloud_cover[ai] ?? 100,
        uvIndex: a.h.uv_index[ai] ?? 0,
        apparentTemp: a.h.apparent_temperature[ai] ?? 10,
        windSpeed: Math.round(a.h.wind_speed_10m[ai] ?? 0),
        isDay: a.h.is_day[ai] ?? 0,
        weatherCode: a.h.weather_code[ai] ?? 0,
        temperature: a.h.apparent_temperature[ai] ?? 10,
      };
      hours.push({ hour: h, aScore: calcHourScore(aHour) });
    }

    if (hours.length === 0) continue;

    // Best actual hour
    const best = hours.reduce((a, b) => b.aScore > a.aScore ? b : a);
    const bh = best.hour;
    const aKey = `${dateStr}T${String(bh).padStart(2, '0')}:00`;
    const fKey = aKey;
    const ai = a.map.get(aKey)!;
    const fi = f.map.get(fKey);

    const aRad   = Math.round(a.h.direct_radiation[ai] ?? 0);
    const aCloud = Math.round(a.h.cloud_cover[ai] ?? 0);
    const aUV    = Math.round((a.h.uv_index[ai] ?? 0) * 10) / 10;
    const aTemp  = Math.round((a.h.apparent_temperature[ai] ?? 0) * 10) / 10;
    const aWind  = Math.round(a.h.wind_speed_10m[ai] ?? 0);
    const aScore = best.aScore;

    const fRad   = fi !== undefined ? Math.round(f.h.direct_radiation[fi] ?? 0) : aRad;
    const fCloud = fi !== undefined ? Math.round(f.h.cloud_cover[fi] ?? 0) : aCloud;
    const fUV    = fi !== undefined ? Math.round((f.h.uv_index[fi] ?? 0) * 10) / 10 : aUV;
    const fTemp  = fi !== undefined ? Math.round((f.h.apparent_temperature[fi] ?? 0) * 10) / 10 : aTemp;
    const fWind  = fi !== undefined ? Math.round(f.h.wind_speed_10m[fi] ?? 0) : aWind;

    const fHour = {
      hour: bh,
      timeLabel: aKey.slice(11),
      directRadiation: fRad,
      cloudCover: fCloud,
      uvIndex: fUV,
      apparentTemp: fTemp,
      windSpeed: fWind,
      isDay: 1,
      weatherCode: fi !== undefined ? (f.h.weather_code[fi] ?? 0) : 0,
      temperature: fTemp,
    };
    const fScore = calcHourScore(fHour);

    results.push({
      date: dateStr,
      bestHour: { hour: bh, fRad, fCloud, fUV, fTemp, fWind, fScore, aRad, aCloud, aUV, aTemp, aWind, aScore },
    });
  }

  return results.sort((a, b) => a.date.localeCompare(b.date));
}
