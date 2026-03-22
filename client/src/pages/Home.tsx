import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchSunForecast,
  reverseGeocode,
  searchCity,
  scoreLabel,
  scoreColor,
  scoreBg,
  hourBarColor,
  bestWindow,
  THRESHOLDS,
  type DayData,
  type HourData,
  type SunForecast,
  type GeoResult,
} from "@/lib/weather";
import {
  calcExposureMinutes,
  bestExposureHour,
  SKIN_TYPES,
} from "@/lib/exposure";
import { fmtTemp, fmtWind, type UnitSystem } from "@/lib/units";
import { fetchActualScores, type DayAccuracy } from "@/lib/historical";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import type { Favourite, VerificationEntry } from "../../../shared/schema";
import {
  MapPin, Sun, Thermometer, Cloud, Wind,
  ChevronDown, ChevronUp, Sunrise, Sunset,
  RefreshCw, AlertCircle, Search, X,
  Star, Trash2, History, ThumbsUp, ThumbsDown, Info,
} from "lucide-react";

// ── Inline Day Bar Chart ─────────────────────────────────────────
// Shows only daylight hours as coloured blocks, no labels/markings.
function DayBars({ hours, sunrise, sunset }: {
  hours: HourData[];
  sunrise: string; // "06:31"
  sunset: string;  // "18:45"
}) {
  const dayHours = hours.filter(h => h.isDay);
  if (dayHours.length === 0) return null;
  const maxH = 48;
  const firstHour = dayHours[0].hour;
  const lastHour = dayHours[dayHours.length - 1].hour;
  const noonIdx = dayHours.findIndex(h => h.hour === 12);

  return (
    <div className="flex flex-col w-full" style={{ paddingBottom: 16 }}>
      {/* Bars */}
      <div className="flex items-end gap-[2px] w-full" style={{ height: maxH }}>
        {dayHours.map(h => {
          const barH = Math.max(3, Math.round((h.sunScore / 100) * maxH));
          // Consistent palette: matches scoreColor labels and hourBarColor
          let bg = "#d1d5db";       // gray-300 — below threshold / no sun
          if (h.sunScore >= 80)      bg = "#ea580c"; // orange-600 — Golden hour
          else if (h.sunScore >= 65) bg = "#eab308"; // yellow-500 — Good sun
          else if (h.sunScore >= 45) bg = "#fef08a"; // yellow-200 — Partial sun
          const showLabel = h.sunScore >= 65;
          return (
            <div key={h.hour} className="flex-1 rounded-sm relative"
              style={{ height: barH, backgroundColor: bg }}>
              {/* Score inside bar */}
              {showLabel && barH >= 14 && (
                <span className="absolute inset-0 flex items-center justify-center"
                  style={{ fontSize: 8, fontWeight: 700, color: 'rgba(0,0,0,0.5)', lineHeight: 1 }}>
                  {h.sunScore}
                </span>
              )}
              {/* Hour label below bar */}
              {showLabel && (
                <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap"
                  style={{ top: '100%', marginTop: 2, fontSize: 8, fontWeight: 600, color: '#78716c', lineHeight: 1 }}>
                  {h.hour}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {/* Time labels: sunrise and sunset only */}
      <div className="relative w-full" style={{ height: 14, marginTop: 16 }}>
        <span className="absolute text-[10px] text-muted-foreground" style={{ left: 0 }}>
          {sunrise}
        </span>
        <span className="absolute text-[10px] text-muted-foreground" style={{ right: 0 }}>
          {sunset}
        </span>
      </div>
    </div>
  );
}

// ── Score Arc (kept for centre score display) ─────────────────────
function ScoreDot({ score, size = 44 }: { score: number; size?: number }) {
  let color = "#94a3b8";
  if (score >= 80) color = "#f59e0b";
  else if (score >= 65) color = "#fb923c";
  else if (score >= 45) color = "#eab308";
  else if (score >= 25) color = "#a8a29e";
  return (
    <div className="shrink-0 flex items-center justify-center rounded-full border-2"
      style={{ width: size, height: size, borderColor: color }}>
      <span className="font-bold text-sm" style={{ color }}>{score}</span>
    </div>
  );
}


// ── Hour Row ──────────────────────────────────────────────────────
function HourRow({ h, isPeak, units }: { h: HourData; isPeak: boolean; units: UnitSystem }) {
  const pct = h.isDay ? h.sunScore : 0;
  return (
    <div className={`flex flex-col gap-1.5 px-3 py-2.5 rounded-lg text-sm transition-colors
      ${isPeak ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40' : 'hover:bg-muted/50'}`}>
      {/* Top row: time + bar + score */}
      <div className="flex items-center gap-3">
        <div className="w-14 shrink-0 flex flex-col">
          <span className={`font-mono text-sm ${isPeak ? 'font-bold text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>
            {h.timeLabel}
          </span>
          {isPeak && (
            <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 leading-none mt-0.5">Peak</span>
          )}
        </div>
        <div className="flex-1 h-2.5 bg-border rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${pct > 0 ? hourBarColor(pct) : ''}`}
            style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-sm font-bold w-8 text-right shrink-0 ${scoreColor(h.sunScore)}`}>
          {h.isDay ? h.sunScore : '—'}
        </span>
      </div>
      {/* Raw variables row — only during daylight */}
      {h.isDay && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-[60px] text-xs">
          {/* Each value coloured red if below its threshold */}
          <span
            title={`Cloud cover — max ${THRESHOLDS.cloudMax}% to qualify`}
            className={`flex items-center gap-0.5 ${
              h.cloudCover > THRESHOLDS.cloudMax ? 'text-red-500 dark:text-red-400 font-medium' : 'text-muted-foreground'
            }`}>
            <Cloud size={11} />{h.cloudCover}%
          </span>
          <span
            title={`UV Index — min ${THRESHOLDS.uvMin} to qualify`}
            className={`flex items-center gap-0.5 ${
              h.uvIndex < THRESHOLDS.uvMin ? 'text-red-500 dark:text-red-400 font-medium' : 'text-muted-foreground'
            }`}>
            <Sun size={11} />UV {h.uvIndex.toFixed(1)}
          </span>
          <span
            title={`Direct radiation — min ${THRESHOLDS.radMin} W/m² to qualify`}
            className={`flex items-center gap-0.5 ${
              h.directRadiation < THRESHOLDS.radMin ? 'text-red-500 dark:text-red-400 font-medium' : 'text-muted-foreground'
            }`}>
            ⚡ {Math.round(h.directRadiation)} W/m²
          </span>
          <span
            title={`Feels-like — min ${fmtTemp(THRESHOLDS.tempMin, units)} to qualify`}
            className={`flex items-center gap-0.5 ${
              h.apparentTemp < THRESHOLDS.tempMin ? 'text-red-500 dark:text-red-400 font-medium' : 'text-muted-foreground'
            }`}>
            <Thermometer size={11} />{fmtTemp(h.apparentTemp, units)} feels-like
          </span>
          <span
            title={`Wind — Beaufort 5 (${fmtWind(29, units)}) starts penalising score`}
            className={`flex items-center gap-0.5 ${
              h.windSpeed >= 50 ? 'text-red-500 dark:text-red-400 font-medium'
              : h.windSpeed >= 39 ? 'text-orange-500 dark:text-orange-400 font-medium'
              : h.windSpeed >= 29 ? 'text-yellow-600 dark:text-yellow-500 font-medium'
              : 'text-muted-foreground'
            }`}>
            <Wind size={11} />{fmtWind(h.windSpeed, units)}
          </span>
          <span className="text-muted-foreground/50">({fmtTemp(h.temperature, units)} actual)</span>
        </div>
      )}
    </div>
  );
}

// ── Exposure Widget ──────────────────────────────────────────────
function ExposureWidget({ day, skinTypeId, onChangeSkin, units }: {
  day: DayData;
  skinTypeId: number;
  onChangeSkin: (id: number) => void;
  units: UnitSystem;
}) {
  const best = bestExposureHour(day.hours);
  if (!best) return null;

  const minutes = calcExposureMinutes(best.uvIndex, skinTypeId);
  if (!minutes) return null;

  const skin = SKIN_TYPES.find(s => s.id === skinTypeId)!;

  return (
    <div className="border-t border-black/[0.05] dark:border-white/[0.05] pt-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        {/* Estimate */}
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">~{minutes} min</span> at {best.timeLabel}
          {' '}— UV {best.uvIndex.toFixed(1)}, {skin.label}
        </p>
        {/* Skin selector — minimal dropdown */}
        <select
          value={skinTypeId}
          onChange={e => onChangeSkin(Number(e.target.value))}
          className="text-xs text-muted-foreground bg-transparent border-none
            cursor-pointer hover:text-foreground transition-colors outline-none
            appearance-none pr-1"
          title="Change skin type"
        >
          {SKIN_TYPES.map(s => (
            <option key={s.id} value={s.id}>{s.label} — {s.description}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Day Card ──────────────────────────────────────────────────────
function DayCard({ day, locationName, skinTypeId, onChangeSkin, units }: {
  day: DayData;
  locationName?: string;
  skinTypeId: number;
  onChangeSkin: (id: number) => void;
  units: UnitSystem;
}) {
  const [expanded, setExpanded] = useState(false);
  const bg = scoreBg(day.dayScore);
  const dayHours = day.hours.filter(h => h.isDay);
  const peak = day.peakWindow;

  return (
    <div className="border border-border rounded-2xl overflow-hidden transition-all bg-card">
      {/* Header — always visible */}
      <button
        data-testid={`day-card-${day.date}`}
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left p-4 flex items-start gap-4 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
      >
        {/* Date */}
        <div className="flex flex-col gap-0.5 shrink-0 w-14">
          <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {day.isToday ? 'Today' : day.weekday}
          </div>
          <div className="text-sm font-medium text-foreground">{day.dateLabel}</div>
        </div>

        {/* Bar chart — fills remaining width */}
        <div className="flex-1 min-w-0">
          <DayBars hours={day.hours} sunrise={day.sunrise} sunset={day.sunset} />
        </div>

        {/* Expand toggle */}
        <div className="text-muted-foreground shrink-0 self-center ml-2">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-black/[0.06] dark:border-white/[0.06] px-4 pb-4 pt-3 flex flex-col gap-4">
          {/* Hourly list — only daylight hours */}
          <div className="flex flex-col gap-0.5">
            {dayHours.map(h => {
              const isPeak = !!(peak && h.hour >= peak.startHour && h.hour < peak.endHour);
              return <HourRow key={h.hour} h={h} isPeak={isPeak} units={units} />;
            })}
          </div>

          {/* Exposure estimate */}
          <ExposureWidget day={day} skinTypeId={skinTypeId} onChangeSkin={onChangeSkin} units={units} />

          {/* Verification prompt — today only, after peak window */}
          {locationName && (
            <VerificationPrompt day={day} locationName={locationName} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Week Summary Bar ──────────────────────────────────────────────
function WeekSummary({ days }: { days: DayData[] }) {
  const best = [...days].sort((a, b) => b.dayScore - a.dayScore)[0];
  const goodDays = days.filter(d => d.dayScore >= 65).length;
  const avgScore = Math.round(days.reduce((s, d) => s + d.dayScore, 0) / days.length);

  return (
    <div className="grid grid-cols-3 gap-3">
      {[
        { label: "Best day", value: `${best.isToday ? 'Today' : best.weekday} · ${best.dateLabel}`, sub: `Score ${best.dayScore}` },
        { label: "Quality sun days", value: `${goodDays} / ${days.length}`, sub: "Score ≥ 65" },
        { label: "Week avg", value: `${avgScore} / 100`, sub: scoreLabel(avgScore) },
      ].map(item => (
        <div key={item.label} className="bg-card border border-border rounded-xl p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">{item.label}</div>
          <div className="text-sm font-semibold text-foreground">{item.value}</div>
          <div className="text-xs text-muted-foreground">{item.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Location Gate ─────────────────────────────────────────────────
function LocationGate({ onLocation }: { onLocation: (lat: number, lon: number, name: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const res = await searchCity(query);
      setResults(res);
      setSearching(false);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const requestGPS = useCallback(() => {
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const name = await reverseGeocode(latitude, longitude);
        setGpsLoading(false);
        onLocation(latitude, longitude, name);
      },
      () => {
        setGpsLoading(false);
        setGpsError("GPS unavailable — please search for your city above.");
      },
      { timeout: 8000, maximumAge: 60000 }
    );
  }, [onLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-sm w-full flex flex-col items-center gap-6">
        {/* Sun logo */}
        <div className="w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <svg viewBox="0 0 64 64" width="48" height="48" fill="none">
            <circle cx="32" cy="32" r="12" fill="#f59e0b" />
            {[0,45,90,135,180,225,270,315].map(deg => {
              const rad = (deg * Math.PI) / 180;
              const x1 = 32 + 17 * Math.cos(rad);
              const y1 = 32 + 17 * Math.sin(rad);
              const x2 = 32 + 24 * Math.cos(rad);
              const y2 = 32 + 24 * Math.sin(rad);
              return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />;
            })}
          </svg>
        </div>

        <div className="text-center">
          <h1 className="text-xl font-bold text-foreground mb-1.5">Solara</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            For people who feel better in the sun — and want to make the most of it.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-2 leading-relaxed max-w-xs mx-auto">
            Sun scores are based on weather data. Everyone’s skin and health needs are different — use your own judgement and consult a doctor if you have light-sensitive conditions.
          </p>
        </div>

        {/* City search — primary */}
        <div className="w-full flex flex-col gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              ref={inputRef}
              data-testid="input-city-search"
              type="text"
              placeholder="Search city — e.g. Évora, Lisboa…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full h-11 pl-9 pr-9 rounded-xl border border-input bg-card text-sm
                placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {query && (
              <button onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Dropdown results */}
          {(results.length > 0 || searching) && (
            <div className="w-full bg-card border border-border rounded-xl overflow-hidden shadow-md">
              {searching && (
                <div className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                  <RefreshCw size={13} className="animate-spin" /> Searching…
                </div>
              )}
              {results.map((r, i) => (
                <button
                  key={i}
                  data-testid={`result-${i}`}
                  onClick={() => onLocation(r.lat, r.lon, r.name)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-accent transition-colors
                    flex flex-col gap-0.5 border-t first:border-t-0 border-border"
                >
                  <span className="font-medium text-foreground">{r.name}</span>
                  <span className="text-xs text-muted-foreground line-clamp-1">
                    {r.displayName ?? [r.admin1, r.country].filter(Boolean).join(', ')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* GPS divider */}
        <div className="w-full flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* GPS button — secondary */}
        <Button
          data-testid="btn-get-location"
          variant="outline"
          onClick={requestGPS}
          disabled={gpsLoading}
          className="w-full h-10 text-sm"
        >
          {gpsLoading ? (
            <><RefreshCw size={14} className="mr-2 animate-spin" />Detecting…</>
          ) : (
            <><MapPin size={14} className="mr-2" />Use my GPS location</>
          )}
        </Button>

        {gpsError && (
          <p className="text-xs text-muted-foreground text-center">{gpsError}</p>
        )}

        <p className="text-xs text-muted-foreground text-center">
          Location is only used to fetch weather. Nothing is stored.
        </p>

        {/* Saved locations — shown to returning users */}
        <FavouritesList onSelect={onLocation} />
      </div>
    </div>
  );
}

function FavouritesList({ onSelect }: { onSelect: (lat: number, lon: number, name: string) => void }) {
  const { data: favs = [] } = useQuery<Favourite[]>({
    queryKey: ['/api/favourites'],
    staleTime: 0,
  });

  if (favs.length === 0) return null;

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground">saved places</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      <div className="flex flex-col gap-1.5">
        {favs.map(f => (
          <button
            key={f.id}
            onClick={() => onSelect(f.lat, f.lon, f.name)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border
              bg-card hover:bg-accent transition-colors text-left group"
          >
            <Star size={13} className="text-amber-500 shrink-0" />
            <span className="text-sm font-medium text-foreground flex-1">{f.name}</span>
            <ChevronDown size={13} className="text-muted-foreground -rotate-90 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── About Panel ────────────────────────────────────────────────
function AboutPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto
        shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
          <h2 className="text-base font-bold text-foreground">About the score</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 flex flex-col gap-6 text-sm">

          {/* How it works */}
          <div>
            <h3 className="font-semibold text-foreground mb-2">How the score works</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Each daylight hour is scored 0–100 across five variables: UV index, direct solar radiation,
              cloud cover, feels-like temperature, and wind speed. Hours below the minimum thresholds
              are capped at 30 — physiologically not meaningful regardless of other conditions.
              The daily score blends the average of all daylight hours with the best 2-hour peak window.
            </p>
          </div>

          {/* Score labels */}
          <div>
            <h3 className="font-semibold text-foreground mb-2">Score labels</h3>
            <div className="flex flex-col gap-2">
              {[
                { label: "Golden hour", range: "80–100", color: "bg-orange-600", desc: "Strong UV, clear sky, warm. Maximum benefit per minute outdoors." },
                { label: "Good sun",    range: "65–79",  color: "bg-yellow-500", desc: "All thresholds met. Minor cloud or lower radiation — still worthwhile." },
                { label: "Partial sun", range: "45–64",  color: "bg-yellow-200 border border-yellow-300", desc: "Qualifying but suboptimal. Longer sessions needed." },
                { label: "Weak sun",    range: "25–44",  color: "bg-gray-300",   desc: "One or more variables barely above threshold. Very extended time required." },
                { label: "No sun",      range: "0–24",   color: "bg-gray-200",   desc: "Below qualification thresholds. UV or radiation insufficient." },
              ].map(s => (
                <div key={s.label} className="flex items-start gap-3">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${s.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">{s.label}</span>
                      <span className="text-[10px] text-muted-foreground">{s.range}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Variable comfort zones */}
          <div className="flex flex-col gap-4">
            <h3 className="font-semibold text-foreground">Variable comfort zones</h3>

            {/* UV Index */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-foreground">UV Index</span>
                <span className="text-[10px] text-muted-foreground">Floor: UV 3 · WHO / GrassrootsHealth</span>
              </div>
              <div className="flex flex-col gap-1">
                {[
                  { range: "< 2",   label: "Vitamin D winter", color: "bg-gray-200",   note: "No practical UVB synthesis. Defined as 'Vitamin D Winter' in the literature — no effective dose possible regardless of exposure duration. (Nutrients, 2024)" },
                  { range: "2–2.9", label: "Insufficient",     color: "bg-gray-300",   note: "UVB present but below the synthesis threshold. No meaningful vitamin D produced. (WHO UV Index)" },
                  { range: "3–4.9", label: "Qualifying",       color: "bg-yellow-200", note: "UVB synthesis begins. ~20–30 min needed for Fitzpatrick Type II skin at UV 3.5. (Overcoming MS; WHO)" },
                  { range: "5–7.9", label: "Good",             color: "bg-yellow-400", note: "Effective range. 10–15 min for Type II skin. Optimal window for vitamin D and mood. (Holick, NEJM 2007)" },
                  { range: "8–10",  label: "Excellent",        color: "bg-orange-500", note: "Peak synthesis. 5–10 min for Type II. Longer exposure raises burn risk without additional D gain. (SunSmart)" },
                  { range: "> 10",  label: "Very high",        color: "bg-red-400 text-white", note: "Equatorial or high-altitude summer. Limit unprotected exposure to under 5 min. (WHO)" },
                ].map(r => (
                  <div key={r.range} className="flex items-start gap-2">
                    <div className={`w-12 shrink-0 text-[10px] font-mono text-center py-0.5 rounded ${r.color}`}>{r.range}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-semibold text-foreground">{r.label} — </span>
                      <span className="text-[10px] text-muted-foreground leading-relaxed">{r.note}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Direct radiation */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-foreground">Direct radiation (W/m²)</span>
                <span className="text-[10px] text-muted-foreground">Floor: 120 W/m²</span>
              </div>
              <div className="flex flex-col gap-1">
                {[
                  { range: "< 50",    label: "Negligible",      color: "bg-gray-200",   note: "Night or deep cloud. No solar irradiance reaching surface." },
                  { range: "50–120",  label: "Below threshold", color: "bg-gray-300",   note: "Heavy cloud or very low sun angle. Too weak for practical benefit outdoors." },
                  { range: "120–250", label: "Marginal",        color: "bg-yellow-200", note: "Moderately cloudy or early/late low-angle sun. Sessions need to be longer to compensate." },
                  { range: "250–500", label: "Good",            color: "bg-yellow-400", note: "Clear-sky morning or afternoon. Meaningful dose achievable in 15–30 min." },
                  { range: "500–700", label: "Excellent",       color: "bg-orange-400", note: "Strong direct sun. Mid-morning to mid-afternoon in spring/summer Portugal. (Open-Meteo archive)" },
                  { range: "> 700",   label: "Peak summer",     color: "bg-orange-600", note: "Peak summer midday irradiance in Iberia. Maximum synthesis rate. (Aug 2025 Lendiosa: 736 W/m² at noon)" },
                ].map(r => (
                  <div key={r.range} className="flex items-start gap-2">
                    <div className={`w-14 shrink-0 text-[10px] font-mono text-center py-0.5 rounded ${r.color}`}>{r.range}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-semibold text-foreground">{r.label} — </span>
                      <span className="text-[10px] text-muted-foreground leading-relaxed">{r.note}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cloud cover */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-foreground">Cloud cover</span>
                <span className="text-[10px] text-muted-foreground">Ceiling: 75% · PubMed 23108371</span>
              </div>
              <div className="flex flex-col gap-1">
                {[
                  { range: "0–10%",   label: "Clear sky",        color: "bg-orange-400", note: "Maximum irradiance. No cloud penalty. Scores driven purely by UV and radiation." },
                  { range: "10–40%",  label: "Mostly clear",     color: "bg-yellow-400", note: "Light cloud diffuses some radiation. Minor effect on synthesis." },
                  { range: "40–75%",  label: "Partly cloudy",    color: "bg-yellow-200", note: "Noticeable reduction. Exposure time needs to increase to compensate." },
                  { range: "75–87%",  label: "Above threshold",  color: "bg-gray-300",   note: "6.5+ octas. Vitamin D exposure time more than doubles above this level. Score capped. (Photochem Photobiol Sci, 2012)" },
                  { range: "> 87%",   label: "Overcast",         color: "bg-gray-400",   note: "7.5+ octas. UVD irradiance at just 45% of clear-sky value. Practically ineffective. (PubMed 23108371)" },
                ].map(r => (
                  <div key={r.range} className="flex items-start gap-2">
                    <div className={`w-12 shrink-0 text-[10px] font-mono text-center py-0.5 rounded ${r.color}`}>{r.range}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-semibold text-foreground">{r.label} — </span>
                      <span className="text-[10px] text-muted-foreground leading-relaxed">{r.note}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Temperature */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-foreground">Feels-like temperature</span>
                <span className="text-[10px] text-muted-foreground">Floor: 8°C</span>
              </div>
              <p className="text-[10px] text-muted-foreground mb-1.5 leading-relaxed">
                Temperature doesn't block UV, but determines how much skin you'll expose —
                and therefore how much vitamin D you can synthesise. Feels-like accounts for wind chill.
              </p>
              <div className="flex flex-col gap-1">
                {[
                  { range: "< 8°C",   label: "Too cold",    color: "bg-gray-300",   note: "Not enough skin exposed in practice for meaningful synthesis. Score capped at 30." },
                  { range: "8–12°C",  label: "Marginal",    color: "bg-yellow-200", note: "Chilly. Face and forearms possible at minimum, but sessions should be brief." },
                  { range: "12–18°C", label: "Comfortable", color: "bg-yellow-400", note: "Typical spring Portugal. Arms and legs exposable for a normal session." },
                  { range: "18–26°C", label: "Ideal",       color: "bg-orange-400", note: "Warm enough to expose significant skin area. Maximum synthesis efficiency." },
                  { range: "> 26°C",  label: "Hot",         color: "bg-orange-600", note: "Excellent for synthesis. Limit unprotected session to recommended time for your skin type." },
                ].map(r => (
                  <div key={r.range} className="flex items-start gap-2">
                    <div className={`w-14 shrink-0 text-[10px] font-mono text-center py-0.5 rounded ${r.color}`}>{r.range}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-semibold text-foreground">{r.label} — </span>
                      <span className="text-[10px] text-muted-foreground leading-relaxed">{r.note}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Wind */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-foreground">Wind speed</span>
                <span className="text-[10px] text-muted-foreground">Beaufort scale · comfort penalty only</span>
              </div>
              <p className="text-[10px] text-muted-foreground mb-1.5 leading-relaxed">
                Wind does not block UV. Penalty reflects whether you'll comfortably stay
                outside long enough to benefit — derived from Beaufort scale descriptions.
              </p>
              <div className="flex flex-col gap-1">
                {[
                  { range: "< 29 km/h",  bf: "B≤4", pts: "0",   color: "bg-orange-400", desc: "Calm to moderate breeze. No effect on comfort." },
                  { range: "29–38 km/h", bf: "B5",  pts: "−5",  color: "bg-yellow-300", desc: "Fresh breeze. Small trees sway; noticeably uncomfortable for extended stays." },
                  { range: "39–49 km/h", bf: "B6",  pts: "−10", color: "bg-gray-300",   desc: "Strong breeze. Large branches move; hard to maintain prolonged skin exposure." },
                  { range: "≥ 50 km/h",  bf: "B7+", pts: "−15", color: "bg-gray-400",   desc: "Near gale. Whole trees in motion; most people will not stay outside." },
                ].map(r => (
                  <div key={r.range} className="flex items-start gap-2">
                    <div className={`w-18 shrink-0 text-[10px] font-mono text-center py-0.5 rounded px-1 ${r.color}`}>{r.range}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-semibold text-foreground">{r.bf} · {r.pts} pts — </span>
                      <span className="text-[10px] text-muted-foreground leading-relaxed">{r.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Exposure estimate */}
          <div>
            <h3 className="font-semibold text-foreground mb-1">Exposure time estimate</h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">
              When you expand a day, Solara estimates minutes needed outdoors for a meaningful
              vitamin D dose at the best qualifying hour. Based on Holick's Rule (NEJM 2007;
              Am J Clin Nutr 2004): ~25% body surface exposed to 1/4 MED. Baseline: 15 min
              at UV 3 for Fitzpatrick Type II. Multipliers from Tsiaras & Weinstock (2011)
              and Nutrients (2024).
            </p>
            <div className="flex flex-col gap-1.5">
              {SKIN_TYPES.map(s => (
                <div key={s.id} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-foreground w-16 shrink-0">{s.label}</span>
                  <span className="text-xs text-muted-foreground flex-1">{s.description}</span>
                  <span className="text-[10px] text-muted-foreground/60 shrink-0">×{s.multiplier}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Skin type caveat */}
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl p-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">Skin type matters</span>
            </div>
            <p className="text-xs text-amber-800/80 dark:text-amber-300/80 leading-relaxed">
              Solara uses the same score for all users, but safe exposure time varies widely.
              Fair skin (Fitzpatrick I–II) may reach MED in under 10 min at UV 8.
              Darker skin (Fitzpatrick V–VI) requires up to 4× longer for the same vitamin D.
              Use the skin type selector in the day view to personalise your estimate.
              (Nutrients, 2024; Holick, NEJM 2007)
            </p>
          </div>

          {/* Medical disclaimer */}
          <div className="border-t border-border pt-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Not medical advice.</strong> Scores are derived
              from publicly available weather data and published UV/photobiology research.
              If you take photosensitising medications (fluoroquinolone antibiotics, tetracyclines,
              thiazide diuretics, certain antidepressants, or retinoids), or have a light-sensitive
              condition (lupus, xeroderma pigmentosum, porphyria), consult your doctor before
              increasing sun exposure.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Favourites Bar ───────────────────────────────────────────────
function FavouritesBar({
  current, onSelect, onSaveCurrent
}: {
  current: { lat: number; lon: number; name: string };
  onSelect: (lat: number, lon: number, name: string) => void;
  onSaveCurrent: () => void;
}) {
  const qc = useQueryClient();
  const { data: favs = [] } = useQuery<Favourite[]>({
    queryKey: ['/api/favourites'],
    staleTime: 0,
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/favourites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/favourites'] }),
  });

  const isSaved = favs.some(f => Math.abs(f.lat - current.lat) < 0.001 && Math.abs(f.lon - current.lon) < 0.001);

  if (favs.length === 0 && isSaved) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {/* Save current button */}
      {!isSaved && (
        <button
          data-testid="btn-save-favourite"
          onClick={onSaveCurrent}
          className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full
            border border-dashed border-amber-400 text-amber-600 dark:text-amber-400
            hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
        >
          <Star size={11} />Save {current.name}
        </button>
      )}

      {/* Saved locations */}
      {favs.map(f => {
        const isActive = Math.abs(f.lat - current.lat) < 0.001 && Math.abs(f.lon - current.lon) < 0.001;
        return (
          <div key={f.id} className={`shrink-0 flex items-center gap-1 rounded-full border pl-3 pr-1.5 py-1
            text-xs transition-colors group
            ${ isActive
              ? 'bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-600 dark:text-amber-300'
              : 'border-border hover:bg-accent text-foreground'
            }`}>
            <button onClick={() => onSelect(f.lat, f.lon, f.name)} className="font-medium">
              {f.name}
            </button>
            <button
              onClick={() => removeMutation.mutate(f.id)}
              className="ml-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
            >
              <X size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Verification Prompt ─────────────────────────────────────────
function VerificationPrompt({ day, locationName }: { day: DayData; locationName: string }) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  // Only show for today after peak window has passed
  const now = new Date();
  const currentHour = now.getHours();
  const peakEnded = day.peakWindow ? currentHour >= day.peakWindow.endHour : currentHour >= 15;
  if (!day.isToday || !peakEnded) return null;

  const { data: existing } = useQuery<VerificationEntry | null>({
    queryKey: ['/api/log', today],
    queryFn: () => apiRequest('GET', `/api/log/${today}`).then(r => r.json()),
    staleTime: 0,
  });

  const logMutation = useMutation({
    mutationFn: (body: object) => apiRequest('POST', '/api/log', body).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/log'] }),
  });

  const [step, setStep] = useState<'went_out' | 'accuracy' | 'done'>('went_out');
  const [wentOut, setWentOut] = useState<boolean | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  if (existing !== undefined && existing !== null) {
    return (
      <div className="mt-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]
        flex items-center gap-2 text-xs text-muted-foreground">
        <History size={12} />
        Logged today — forecast matched: {'\u2B50'.repeat(existing.sunAccuracy ?? 0) || 'n/a'}
        {existing.feltWorthIt !== null && (
          existing.feltWorthIt ? <ThumbsUp size={12} className="text-amber-500" /> : <ThumbsDown size={12} className="text-muted-foreground" />
        )}
      </div>
    );
  }

  const submitNo = () => {
    logMutation.mutate({
      date: today,
      locationName,
      forecastScore: day.dayScore,
      peakStart: day.peakWindow?.start ?? null,
      peakEnd: day.peakWindow?.end ?? null,
      wentOut: 0,
      sunAccuracy: null,
      feltWorthIt: null,
    });
  };

  const submitYes = (acc: number, worth: boolean) => {
    logMutation.mutate({
      date: today,
      locationName,
      forecastScore: day.dayScore,
      peakStart: day.peakWindow?.start ?? null,
      peakEnd: day.peakWindow?.end ?? null,
      wentOut: 1,
      sunAccuracy: acc,
      feltWorthIt: worth ? 1 : 0,
    });
  };

  return (
    <div className="mt-2 pt-3 border-t border-amber-200/60 dark:border-amber-700/30 flex flex-col gap-2">
      <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Peak window passed — quick check-in:</p>

      {step === 'went_out' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Did you go out?</span>
          <button
            onClick={() => { setWentOut(true); setStep('accuracy'); }}
            className="text-xs px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30
              text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-600
              hover:bg-amber-200 transition-colors font-medium"
          >Yes</button>
          <button
            onClick={() => { setWentOut(false); submitNo(); }}
            className="text-xs px-3 py-1 rounded-full border border-border
              text-muted-foreground hover:bg-accent transition-colors"
          >No</button>
        </div>
      )}

      {step === 'accuracy' && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">How sunny was it vs forecast?</span>
          <div className="flex gap-1">
            {[1,2,3,4,5].map(n => (
              <button key={n}
                onClick={() => setAccuracy(n)}
                className={`text-base transition-transform hover:scale-110 ${
                  accuracy !== null && n <= accuracy ? 'opacity-100' : 'opacity-30'
                }`}>
                ⭐
              </button>
            ))}
          </div>
          {accuracy !== null && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Worth it?</span>
              <button onClick={() => submitYes(accuracy, true)}
                className="text-xs px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30
                  text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-600
                  hover:bg-amber-200 transition-colors"
              ><ThumbsUp size={11} className="inline mr-1" />Yes</button>
              <button onClick={() => submitYes(accuracy, false)}
                className="text-xs px-3 py-1 rounded-full border border-border
                  text-muted-foreground hover:bg-accent transition-colors"
              ><ThumbsDown size={11} className="inline mr-1" />No</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── History Section ───────────────────────────────────────────────
function HistorySection() {
  const [open, setOpen] = useState(false);
  const { data: logs = [] } = useQuery<VerificationEntry[]>({
    queryKey: ['/api/log'],
    staleTime: 0,
  });

  if (logs.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <History size={14} />
        Check-in history ({logs.length})
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Location</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">Forecast</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">Went out</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">Accuracy</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">Worth it</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 text-muted-foreground">{log.date}</td>
                  <td className="px-3 py-2 font-medium">{log.locationName}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={scoreColor(log.forecastScore)}>{log.forecastScore}</span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {log.wentOut ? '✔️' : '❌'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {log.sunAccuracy ? '⭐'.repeat(log.sunAccuracy) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {log.feltWorthIt === null ? '—' : log.feltWorthIt ? <ThumbsUp size={12} className="inline text-amber-500" /> : <ThumbsDown size={12} className="inline text-muted-foreground" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Accuracy Section ──────────────────────────────────────────────
function AccuracySection({
  lat, lon, logs, units
}: {
  lat: number;
  lon: number;
  logs: import("../../../shared/schema").VerificationEntry[];
  units: UnitSystem;
}) {
  const [open, setOpen] = useState(false);

  const { data: actuals, isLoading, isError } = useQuery<DayAccuracy[]>({
    queryKey: ['accuracy', lat, lon],
    queryFn: () => fetchActualScores(lat, lon),
    enabled: open,
    staleTime: 1000 * 60 * 60, // 1 hour
    retry: 1,
  });

  // Merge check-in log scores into actuals
  const rows = actuals?.map(a => {
    const log = logs.find(l => l.date === a.date);
    const forecastScore = log?.forecastScore ?? null;
    const delta = forecastScore !== null ? a.actualScore - forecastScore : null;
    return { ...a, forecastScore, delta };
  }) ?? [];

  // Bias summary
  const diffs = rows.filter(r => r.delta !== null).map(r => r.delta as number);
  const avgBias = diffs.length > 0
    ? Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length)
    : null;

  function deltaColor(d: number | null) {
    if (d === null) return 'text-muted-foreground';
    if (d > 8) return 'text-emerald-600 dark:text-emerald-400';
    if (d < -8) return 'text-red-500 dark:text-red-400';
    return 'text-muted-foreground';
  }

  function deltaLabel(d: number | null) {
    if (d === null) return '—';
    if (d > 0) return `+${d}`;
    return `${d}`;
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <Sun size={14} />
        Forecast accuracy — past 7 days
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="flex flex-col gap-3">
          {/* Bias summary */}
          {avgBias !== null && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Average bias:</span>
              <span className={`font-semibold ${deltaColor(avgBias)}`}>
                {deltaLabel(avgBias)} pts
              </span>
              <span className="opacity-60">
                {avgBias > 3 ? '(forecast under-predicts)'
                  : avgBias < -3 ? '(forecast over-predicts)'
                  : '(well calibrated)'}
              </span>
            </div>
          )}

          {isLoading && <Skeleton className="h-32 rounded-xl" />}

          {isError && (
            <p className="text-xs text-muted-foreground">Could not load historical data.</p>
          )}

          {rows.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">Forecast</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">Actual</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">Delta</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Cloud</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">UV</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Rad</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Wind</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.date} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 text-muted-foreground">{row.date}</td>
                      <td className="px-3 py-2 text-center">
                        {row.forecastScore !== null
                          ? <span className={scoreColor(row.forecastScore)}>{row.forecastScore}</span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={scoreColor(row.actualScore)}>{row.actualScore}</span>
                      </td>
                      <td className={`px-3 py-2 text-center font-medium ${deltaColor(row.delta)}`}>
                        {deltaLabel(row.delta)}
                      </td>
                      <td className="px-3 py-2 text-center text-muted-foreground hidden sm:table-cell">{row.cloudActual}%</td>
                      <td className="px-3 py-2 text-center text-muted-foreground hidden sm:table-cell">{row.uvActual}</td>
                      <td className="px-3 py-2 text-center text-muted-foreground hidden sm:table-cell">{row.radActual}W</td>
                      <td className="px-3 py-2 text-center text-muted-foreground hidden sm:table-cell">{fmtWind(row.windActual, units)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground/60">
                Actuals from Open-Meteo Historical API. Delta = actual − forecast (positive = under-predicted).
                Forecast scores only available for days with check-ins.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────
export default function Home() {
  const [location, setLocation] = useState<{ lat: number; lon: number; name: string } | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [skinTypeId, setSkinTypeId] = useState(2);
  const [units, setUnits] = useState<UnitSystem>('metric');
  const qc = useQueryClient();

  // Load saved preferences on mount
  const { data: skinPref } = useQuery<{ value: string | null }>({
    queryKey: ['/api/prefs/skin_type'],
    staleTime: Infinity,
  });
  const { data: unitsPref } = useQuery<{ value: string | null }>({
    queryKey: ['/api/prefs/units'],
    staleTime: Infinity,
  });
  useEffect(() => {
    if (skinPref?.value) setSkinTypeId(Number(skinPref.value));
  }, [skinPref]);
  useEffect(() => {
    if (unitsPref?.value === 'imperial') setUnits('imperial');
  }, [unitsPref]);

  const saveSkinType = useCallback((id: number) => {
    setSkinTypeId(id);
    apiRequest('POST', '/api/prefs/skin_type', { value: String(id) });
  }, []);

  const toggleUnits = useCallback(() => {
    const next: UnitSystem = units === 'metric' ? 'imperial' : 'metric';
    setUnits(next);
    apiRequest('POST', '/api/prefs/units', { value: next });
  }, [units]);

  const { data, isLoading, isError, refetch } = useQuery<SunForecast>({
    queryKey: ['sun', location?.lat, location?.lon],
    queryFn: () => fetchSunForecast(location!.lat, location!.lon, location!.name),
    enabled: !!location,
    staleTime: 1000 * 60 * 30,
    retry: 1,
  });

  // Logs needed for accuracy section
  const { data: logsData = [] } = useQuery<import("../../../shared/schema").VerificationEntry[]>({
    queryKey: ['/api/log'],
    staleTime: 0,
    enabled: !!location,
  });

  const saveFavouriteMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/favourites', {
      name: location!.name,
      lat: location!.lat,
      lon: location!.lon,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/favourites'] }),
  });

  if (!location) {
    return <LocationGate onLocation={(lat, lon, name) => setLocation({ lat, lon, name })} />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {aboutOpen && <AboutPanel onClose={() => setAboutOpen(false)} />}

      {/* Header */}
      <header className="sticky top-0 z-20 bg-card/90 backdrop-blur-sm border-b">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 32 32" width="26" height="26" fill="none">
              <circle cx="16" cy="16" r="6" fill="#f59e0b" />
              {[0,60,120,180,240,300].map(deg => {
                const rad = (deg * Math.PI) / 180;
                const x1 = 16 + 9 * Math.cos(rad), y1 = 16 + 9 * Math.sin(rad);
                const x2 = 16 + 13 * Math.cos(rad), y2 = 16 + 13 * Math.sin(rad);
                return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />;
              })}
            </svg>
            <span className="font-bold text-base">Solara</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              data-testid="btn-toggle-units"
              onClick={toggleUnits}
              className="text-xs font-medium text-muted-foreground hover:text-foreground
                transition-colors px-2 py-1 rounded-lg hover:bg-accent"
              title="Toggle units"
            >
              {units === 'metric' ? '°C' : '°F'}
            </button>
            <button
              data-testid="btn-about"
              onClick={() => setAboutOpen(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="About the score"
            >
              <Info size={14} />
              <span className="hidden sm:inline">About the score</span>
            </button>
            <button
              data-testid="btn-change-location"
              onClick={() => setLocation(null)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <MapPin size={13} />
              <span className="max-w-[140px] truncate">{location.name}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 flex flex-col gap-4">

        {/* Favourites bar */}
        <FavouritesBar
          current={location}
          onSelect={(lat, lon, name) => setLocation({ lat, lon, name })}
          onSaveCurrent={() => saveFavouriteMutation.mutate()}
        />

        {isLoading && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        )}

        {isError && (
          <div className="text-center py-12 flex flex-col items-center gap-3">
            <AlertCircle className="text-destructive" size={32} />
            <p className="text-sm text-muted-foreground">Could not load weather data.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw size={14} className="mr-1.5" />Try again
            </Button>
          </div>
        )}

        {data && (
          <>
            {/* Day cards */}
            <div className="flex flex-col gap-2">
              {data.days.map(day => (
                <DayCard
                  key={day.date}
                  day={day}
                  locationName={location.name}
                  skinTypeId={skinTypeId}
                  onChangeSkin={saveSkinType}
                  units={units}
                />
              ))}
            </div>

            {/* History + Accuracy */}
            <HistorySection />
            <AccuracySection
              lat={location.lat}
              lon={location.lon}
              logs={logsData}
              units={units}
            />
          </>
        )}
      </main>

      <footer className="border-t py-3 px-6 text-xs text-muted-foreground flex flex-wrap justify-between gap-2">
        <span>Weather: <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">Open-Meteo</a> (CC BY 4.0)</span>
        <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
          Created with Perplexity Computer
        </a>
      </footer>
    </div>
  );
}
