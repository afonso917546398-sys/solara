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

// ── Solara Index ───────────────────────────────────────────
// A personal preference index: higher scores = hotter, sunnier, higher UV,
// lower wind. Not a health-safety recommendation.
//
// Raw API fields used (all already fetched from Open-Meteo):
//   apparentTemp     °C    feels-like temperature
//   directRadiation  W/m²  actual sunlight hitting the ground
//   cloudCover       %     0 = clear sky, 100 = fully overcast
//   uvIndex          –     0–11+ scale
//   windSpeed        km/h  at 10m
//   isDay            0|1   0 = night, always scores 0
//   weatherCode      WMO   fog/rain/storm always scores 0

// kept for About panel display only (no longer used as hard gates)
export const THRESHOLDS = {
  uvMin: 3,
  cloudMax: 75,
  radMin: 120,
  tempMin: 8,
};

// ── Wind multiplier ──────────────────────────────────────────────────
// Smooth continuous multiplier. Calibrated against real session data
// (Praia de Mira 24 Mar 2026: pleasant at 11-14 km/h).
// ≤ 15 km/h → 1.0   (gentle breeze or less, no penalty)
// 15–30 km/h → 1.0→0.7 (moderate, noticeable but still enjoyable)
// 30–50 km/h → 0.7→0.4 (strong, significantly reduces comfort)
// > 50 km/h → 0.3   (near gale, most people leave)
function windFactor(ws: number): number {
  if (ws <= 15) return 1.0;
  if (ws <= 30) return 1.0 - 0.3 * (ws - 15) / (30 - 15);
  if (ws <= 50) return 0.7 - 0.3 * (ws - 30) / (50 - 30);
  return 0.3;
}

// ── Main scoring function ──────────────────────────────────────────────
export function calcHourScore(h: Omit<HourData, 'sunScore'>): number {
  // Night — always 0
  if (!h.isDay) return 0;

  // Fog / rain / thunderstorm — always 0 regardless of other variables
  const badWeather =
    (h.weatherCode >= 45 && h.weatherCode <= 49) ||
    (h.weatherCode >= 51 && h.weatherCode <= 82) ||
    h.weatherCode >= 95;
  if (badWeather) return 0;

  // ── 1. temp_term: apparentTemp 10–40°C → 0–25 pts ───────────────
  // Linear. Below 10°C = 0 (can't expose skin). Above 40°C = capped at 25.
  // No hard disqualification — cold just scores low, not zero.
  const tempTerm = Math.max(0, Math.min(25,
    ((h.apparentTemp - 10) / (40 - 10)) * 25
  ));

  // ── 2. sun_term: directRadiation 0–800 W/m² → 0–45 pts ─────────
  // Raised from 35→45 pts. Radiation already encodes cloud conditions
  // physically (cloud blocks radiation), so it should carry more weight.
  const sunTerm = Math.min(45, (h.directRadiation / 800) * 45);

  // ── 3. cloud_term: cloudCover 0–100% → 0–15 pts ──────────────
  // Reduced from 25→15 pts to avoid double-penalising cloud alongside
  // radiation (which already captures the physical effect of cloud cover).
  const cloudTerm = ((100 - h.cloudCover) / 100) * 15;

  // ── 4. uv_term: uvIndex 0–10 → 0–15 pts ────────────────────
  // Capped at UV 10 (extreme). Higher = more sun-lover appeal.
  const uvTerm = Math.min(15, (h.uvIndex / 10) * 15);

  // ── Base score (sum of four terms, max ≈ 100) ─────────────────
  const base = tempTerm + sunTerm + cloudTerm + uvTerm;

  // ── 5. Wind multiplier (continuous, not step-based) ─────────────
  const score = base * windFactor(h.windSpeed);

  return Math.max(0, Math.min(100, Math.round(score)));
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
  if (score >= 80) return "Prime sun";
  if (score >= 65) return "Good sun";
  if (score >= 45) return "Fair sun";
  if (score >= 25) return "Weak sun";
  return "No sun";
}

export function scoreColor(score: number): string {
  if (score >= 80) return "text-orange-600 dark:text-orange-400";
  if (score >= 65) return "text-yellow-600 dark:text-yellow-400";
  if (score >= 45) return "text-yellow-500 dark:text-yellow-500";
  if (score >= 25) return "text-stone-400 dark:text-stone-400";
  return "text-gray-400 dark:text-gray-500";
}

export function scoreBg(score: number): string {
  if (score >= 80) return "bg-amber-50 border-amber-200 dark:bg-amber-900/15 dark:border-amber-700/50";
  if (score >= 65) return "bg-orange-50 border-orange-200 dark:bg-orange-900/15 dark:border-orange-700/50";
  if (score >= 45) return "bg-yellow-50 border-yellow-200 dark:bg-yellow-900/15 dark:border-yellow-700/50";
  if (score >= 25) return "bg-stone-50 border-stone-200 dark:bg-stone-800/30 dark:border-stone-700/50";
  return "bg-slate-50 border-slate-200 dark:bg-slate-800/20 dark:border-slate-700/30";
}

export function hourBarColor(score: number): string {
  if (score >= 80) return "bg-orange-600";
  if (score >= 65) return "bg-yellow-500";
  if (score >= 45) return "bg-yellow-200";
  return "bg-gray-300";
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

import { ipcjWindFactor, estimateUV, effectiveRadiation } from './corrections';

export async function fetchSunForecast(
  lat: number,
  lon: number,
  locationName: string,
  ipcjExposure: import('./corrections').IpcjExposure = 'none'
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
    const month = parseInt(date.split('-')[1], 10);

    // ── Correction 1: IPCJ wind adjustment ───────────────────────
    // Multiply reported wind by IPCJ factor for affected coastal locations.
    const rawWind = hourly.wind_speed_10m[i];
    const correctedWind = Math.round(rawWind * ipcjWindFactor(ipcjExposure, month, hour));

    // ── Correction 2: UV fallback when archive returns null ───────
    const rawUV = hourly.uv_index[i];
    const uvIndex = (rawUV !== null && rawUV !== undefined)
      ? rawUV
      : estimateUV(hourly.direct_radiation[i], hour, month);

    // ── Correction 3: radiation saturation above 500 W/m² ────────
    const rawRad = hourly.direct_radiation[i];
    const effectRad = effectiveRadiation(rawRad);

    const hBase = {
      hour,
      timeLabel: `${String(hour).padStart(2, '0')}:00`,
      cloudCover: hourly.cloud_cover[i],
      uvIndex,
      temperature: Math.round(hourly.temperature_2m[i] * 10) / 10,
      apparentTemp: Math.round(hourly.apparent_temperature[i] * 10) / 10,
      directRadiation: effectRad,       // saturation-corrected
      windSpeed: correctedWind,          // IPCJ-corrected
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
