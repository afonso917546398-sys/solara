export interface HourData {
  hour: number;           // 0–23
  timeLabel: string;      // "09:00"
  cloudCover: number;     // %
  uvIndex: number;
  temperature: number;    // °C
  apparentTemp: number;   // feels-like °C
  directRadiation: number;// W/m²
  windSpeed: number;      // km/h at 10m
  isDay: number;          // 0 or 1
  weatherCode: number;
  sunScore: number;       // 0–100 our score
}

export interface DayData {
  date: string;           // "2024-06-15"
  weekday: string;        // "Mon"
  dateLabel: string;      // "15 Jun"
  isToday: boolean;
  sunrise: string;        // "06:23"
  sunset: string;         // "20:45"
  dayScore: number;       // 0–100
  scoreLabel: string;
  peakWindow: { start: string; end: string; score: number } | null;
  hours: HourData[];
}

export interface SunForecast {
  locationName: string;
  lat: number;
  lon: number;
  days: DayData[];
}

// WMO code → clear sky bonus/penalty
function wmoSunPenalty(code: number): number {
  if (code === 0) return 0;          // clear sky — no penalty
  if (code === 1) return -5;         // mainly clear
  if (code === 2) return -15;        // partly cloudy
  if (code === 3) return -25;        // overcast
  if (code >= 45 && code <= 49) return -30; // fog
  if (code >= 51 && code <= 67) return -20; // drizzle/rain
  if (code >= 71 && code <= 77) return -15; // snow
  if (code >= 80 && code <= 82) return -20; // rain showers
  if (code >= 95) return -30;        // thunderstorm
  return -10;
}

// ── Qualification thresholds ─────────────────────────────────────
// Below any of these, the hour does not qualify for meaningful sun exposure.
// Thresholds are science-based but have deliberate margin so borderline
// hours near the floor still show a low (non-zero) score rather than
// a hard cliff — they just score poorly.
export const THRESHOLDS = {
  // UV < 3 = no UVB → no vitamin D synthesis (GrassrootsHealth, SunSmart)
  uvMin: 3,
  // Cloud > 75% (~6.5 octas) → vitamin D exposure time multiplies 2x+ (PubMed 23108371)
  cloudMax: 75,
  // Direct radiation < 120 W/m² ≈ heavily overcast — not practically useful outdoors
  radMin: 120,
  // Feels-like < 8°C → too cold to expose enough skin to benefit
  tempMin: 8,
};

export function calcHourScore(h: Omit<HourData, 'sunScore'>): number {
  if (!h.isDay) return 0;

  // Hard disqualifiers — conditions where exposure isn't physiologically meaningful.
  // WMO codes for fog/rain/storm are also hard disqualifiers regardless of other numbers.
  const badWeather = (h.weatherCode >= 45 && h.weatherCode <= 49) ||
    (h.weatherCode >= 51 && h.weatherCode <= 82) ||
    h.weatherCode >= 95;
  if (badWeather) return 0;

  // Soft gates: hours below minimums score in a reduced 0–30 range
  // so they appear clearly inferior without a jarring cliff.
  const belowUV    = h.uvIndex < THRESHOLDS.uvMin;
  const belowRad   = h.directRadiation < THRESHOLDS.radMin;
  const belowTemp  = h.apparentTemp < THRESHOLDS.tempMin;
  const tooCloud   = h.cloudCover > THRESHOLDS.cloudMax;
  const disqualified = belowUV || belowRad || belowTemp || tooCloud;

  // ── Score within qualifying range (0–100) ──────────────────────
  // Only reached when all thresholds are cleared.
  // Each component scores relative to the range ABOVE the threshold.

  // 1. Cloud cover: 0–75% qualified range → 0–45 pts
  //    Scored from 0% (best) down to the 75% ceiling.
  const cloudScore = Math.round((1 - h.cloudCover / THRESHOLDS.cloudMax) * 45);

  // 2. Direct radiation: 120–800 W/m² qualified range → 0–30 pts
  //    sqrt scaling preserves sensitivity at lower end.
  const radRange = 800 - THRESHOLDS.radMin;
  const radAbove = Math.max(0, h.directRadiation - THRESHOLDS.radMin);
  const radScore = Math.round(Math.min(30, (Math.sqrt(radAbove) / Math.sqrt(radRange)) * 30));

  // 3. UV index: 3–8 qualified range → 0–15 pts
  const uvRange = 8 - THRESHOLDS.uvMin;
  const uvAbove = Math.max(0, h.uvIndex - THRESHOLDS.uvMin);
  const uvScore = Math.round(Math.min(15, (uvAbove / uvRange) * 15));

  // 4. Feels-like temp: 8–22°C qualified range → 0–10 pts
  const tempRange = 22 - THRESHOLDS.tempMin;
  const tempAbove = Math.max(0, Math.min(tempRange, h.apparentTemp - THRESHOLDS.tempMin));
  const tempScore = Math.round((tempAbove / tempRange) * 10);

  // 5. Wind comfort penalty (Beaufort scale) → 0–15 pts deducted
  //    Beaufort 5 (29 km/h) = small trees sway, noticeably uncomfortable
  //    Beaufort 6 (39 km/h) = large branches move, hard to use umbrella
  //    Beaufort 7 (50 km/h) = whole trees in motion, effort to walk against
  //    Wind does not block light — this is a comfort/stay-outdoors penalty only.
  let windPenalty = 0;
  if (h.windSpeed >= 50) windPenalty = 15;       // Beaufort 7+ — most people won't stay out
  else if (h.windSpeed >= 39) windPenalty = 10;  // Beaufort 6 — unpleasant
  else if (h.windSpeed >= 29) windPenalty = 5;   // Beaufort 5 — noticeably uncomfortable

  const qualified = cloudScore + radScore + uvScore + tempScore - windPenalty; // max ~100

  if (disqualified) {
    // Show how close to qualifying — max 30 so it's clearly below any real hour
    return Math.min(30, Math.round(qualified * 0.3));
  }

  return Math.max(0, Math.min(100, qualified));
}

function calcDayScore(hours: HourData[]): number {
  const dayHours = hours.filter(h => h.isDay && h.sunScore > 0);
  if (dayHours.length === 0) return 0;
  const avg = dayHours.reduce((s, h) => s + h.sunScore, 0) / dayHours.length;
  // Weight towards the peak (max score of any 2h window)
  const peak = bestWindow(dayHours, 2)?.score ?? avg;
  return Math.round(avg * 0.5 + peak * 0.5);
}

export function scoreLabel(score: number): string {
  if (score >= 80) return "Golden hour";
  if (score >= 65) return "Good sun";
  if (score >= 45) return "Partial sun";
  if (score >= 25) return "Weak sun";
  return "No sun";
}

export function scoreColor(score: number): string {
  if (score >= 80) return "text-amber-600 dark:text-amber-400";
  if (score >= 65) return "text-orange-500 dark:text-orange-400";
  if (score >= 45) return "text-yellow-600 dark:text-yellow-500";
  if (score >= 25) return "text-stone-500 dark:text-stone-400";
  return "text-slate-400 dark:text-slate-500";
}

export function scoreBg(score: number): string {
  if (score >= 80) return "bg-amber-50 border-amber-200 dark:bg-amber-900/15 dark:border-amber-700/50";
  if (score >= 65) return "bg-orange-50 border-orange-200 dark:bg-orange-900/15 dark:border-orange-700/50";
  if (score >= 45) return "bg-yellow-50 border-yellow-200 dark:bg-yellow-900/15 dark:border-yellow-700/50";
  if (score >= 25) return "bg-stone-50 border-stone-200 dark:bg-stone-800/30 dark:border-stone-700/50";
  return "bg-slate-50 border-slate-200 dark:bg-slate-800/20 dark:border-slate-700/30";
}

export function hourBarColor(score: number): string {
  if (score >= 80) return "bg-amber-400";
  if (score >= 65) return "bg-amber-300";
  if (score >= 45) return "bg-yellow-200";
  if (score >= 25) return "bg-stone-200";
  return "bg-slate-100 dark:bg-slate-700";
}

// Find best consecutive window of `windowHours` with highest avg score
export function bestWindow(
  hours: HourData[],
  windowHours: number
): { start: string; end: string; score: number; startHour: number; endHour: number } | null {
  if (hours.length < windowHours) return null;
  let best = -1;
  let bestIdx = 0;
  for (let i = 0; i <= hours.length - windowHours; i++) {
    const avg = hours.slice(i, i + windowHours).reduce((s, h) => s + h.sunScore, 0) / windowHours;
    if (avg > best) { best = avg; bestIdx = i; }
  }
  if (best <= 0) return null;
  const startHour = hours[bestIdx].hour;
  const endHour = hours[bestIdx + windowHours - 1].hour + 1;
  return {
    start: `${String(startHour).padStart(2, '0')}:00`,
    end: `${String(endHour).padStart(2, '0')}:00`,
    score: Math.round(best),
    startHour,
    endHour,
  };
}

function parseTime(iso: string): string {
  const t = iso.split('T')[1];
  if (!t) return '00:00';
  return t.slice(0, 5);
}

export async function fetchSunForecast(
  lat: number,
  lon: number,
  locationName: string
): Promise<SunForecast> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat.toString());
  url.searchParams.set('longitude', lon.toString());
  url.searchParams.set('hourly', [
    'cloud_cover',
    'uv_index',
    'temperature_2m',
    'apparent_temperature',
    'direct_radiation',
    'wind_speed_10m',
    'weather_code',
    'is_day',
  ].join(','));
  url.searchParams.set('daily', ['sunrise', 'sunset'].join(','));
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '7');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Weather API error');
  const data = await res.json();

  const { hourly, daily } = data;
  const times: string[] = hourly.time;

  // Group into days
  const dayMap = new Map<string, HourData[]>();
  times.forEach((t, i) => {
    const date = t.split('T')[0];
    const hour = parseInt(t.split('T')[1].slice(0, 2), 10);
    const hBase = {
      hour,
      timeLabel: `${String(hour).padStart(2, '0')}:00`,
      cloudCover: hourly.cloud_cover[i],
      uvIndex: hourly.uv_index[i],
      temperature: Math.round(hourly.temperature_2m[i] * 10) / 10,
      apparentTemp: Math.round(hourly.apparent_temperature[i] * 10) / 10,
      directRadiation: hourly.direct_radiation[i],
      windSpeed: Math.round(hourly.wind_speed_10m[i]),
      isDay: hourly.is_day[i],
      weatherCode: hourly.weather_code[i],
    };
    const sunScore = calcHourScore(hBase);
    if (!dayMap.has(date)) dayMap.set(date, []);
    dayMap.get(date)!.push({ ...hBase, sunScore });
  });

  const today = new Date().toISOString().slice(0, 10);

  const days: DayData[] = daily.time.map((date: string, i: number) => {
    const hours = dayMap.get(date) ?? [];
    const d = new Date(date + 'T12:00:00');
    const dayHours = hours.filter(h => h.isDay);

    const dayScore = calcDayScore(hours);
    const peak = bestWindow(dayHours, 2);

    return {
      date,
      weekday: d.toLocaleDateString('en-GB', { weekday: 'short' }),
      dateLabel: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      isToday: date === today,
      sunrise: parseTime(daily.sunrise[i]),
      sunset: parseTime(daily.sunset[i]),
      dayScore,
      scoreLabel: scoreLabel(dayScore),
      peakWindow: peak,
      hours,
    };
  });

  return { locationName, lat, lon, days };
}

// Reverse geocode using Open-Meteo geocoding API
export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    const addr = data.address;
    return addr?.city || addr?.town || addr?.village || addr?.county || 'Your location';
  } catch {
    return 'Your location';
  }
}

export interface GeoResult {
  name: string;
  lat: number;
  lon: number;
  country: string;
  admin1?: string;
  displayName?: string; // full OSM display string for disambiguation
}

export async function searchCity(query: string): Promise<GeoResult[]> {
  if (!query.trim()) return [];
  // Nominatim covers hamlets, villages, streets — full OSM address database
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query.trim());
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '6');
  url.searchParams.set('accept-language', 'en');
  const res = await fetch(url.toString(), {
    headers: { 'Accept-Language': 'en' }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data as any[]).map((r: any) => {
    const addr = r.address ?? {};
    const name =
      addr.hamlet ?? addr.village ?? addr.suburb ?? addr.town ??
      addr.city ?? addr.municipality ?? r.display_name.split(',')[0];
    const admin1 = addr.county ?? addr.state ?? '';
    const country = addr.country ?? '';
    return {
      name,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      country,
      admin1,
      displayName: r.display_name,
    };
  });
}
