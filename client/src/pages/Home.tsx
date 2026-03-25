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
import { defaultIpcjExposure, type IpcjExposure } from "@/lib/ipcj";
import { ipcjWindFactor } from "@/lib/corrections";

import { fmtTemp, fmtWind, type UnitSystem } from "@/lib/units";
import { fetchActualScores, type DayAccuracy } from "@/lib/historical";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import type { Favourite } from "../../../shared/schema";
import {
  MapPin, Sun, Thermometer, Cloud, Wind,
  ChevronDown, ChevronUp, Sunrise, Sunset,
  RefreshCw, AlertCircle, Search, X,
  Star, Trash2, Info,
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
  const maxH = 56;
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
          if (h.sunScore >= 80)      bg = "#ea580c"; // orange-600 — Prime sun
          else if (h.sunScore >= 65) bg = "#eab308"; // yellow-500 — Good sun
          else if (h.sunScore >= 45) bg = "#fef08a"; // yellow-200 — Fair sun
          const showLabel = h.sunScore >= 45;
          return (
            <div key={h.hour} className="flex-1 rounded-sm relative"
              style={{ height: barH, backgroundColor: bg }}>
              {/* Score inside bar */}
              {showLabel && barH >= 14 && (
                <span className="absolute inset-0 flex items-center justify-center"
                  style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.55)', lineHeight: 1 }}>
                  {h.sunScore}
                </span>
              )}
              {/* Hour label below bar */}
              {showLabel && (
                <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap"
                  style={{ top: '100%', marginTop: 2, fontSize: 10, fontWeight: 600, color: '#78716c', lineHeight: 1 }}>
                  {h.hour}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {/* Time labels: sunrise and sunset only */}
      <div className="relative w-full" style={{ height: 14, marginTop: 16 }}>
        <span className="absolute text-xs text-muted-foreground" style={{ left: 0 }}>
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
function HourRow({ h, units, ipcjExposure, dayMonth }: { h: HourData; units: UnitSystem; ipcjExposure: IpcjExposure; dayMonth: number }) {
  const pct = h.isDay ? h.sunScore : 0;
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg text-sm transition-colors hover:bg-muted/50">
      {/* Top row: time + bar + score */}
      <div className="flex items-center gap-3">
        <div className="w-14 shrink-0">
          <span className="font-mono text-xs text-muted-foreground">{h.timeLabel}</span>
        </div>
        <div className="flex-1 h-3 bg-border rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${pct > 0 ? hourBarColor(pct) : ''}`}
            style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-base font-bold w-8 text-right shrink-0 ${scoreColor(h.sunScore)}`}>
          {h.isDay ? h.sunScore : '—'}
        </span>
      </div>
      {/* Raw variables row — only during daylight, ordered by score weight: radiation, cloud, UV, temp, wind */}
      {h.isDay && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-[60px] text-xs text-muted-foreground">
          <span className="flex items-center gap-0.5" title="Direct radiation (W/m²)">
            ⚡ {Math.round(h.directRadiation)} W/m²
          </span>
          <span className="flex items-center gap-0.5" title="Cloud cover">
            <Cloud size={11} />{h.cloudCover}%
          </span>
          <span className="flex items-center gap-0.5" title="UV Index">
            <Sun size={11} />UV {h.uvIndex.toFixed(1)}
          </span>
          <span className="flex items-center gap-0.5" title="Feels-like temperature">
            <Thermometer size={11} />{fmtTemp(h.apparentTemp, units)} feels-like
          </span>
          <span className="flex items-center gap-0.5" title="Wind speed">
            <Wind size={11} />{fmtWind(h.windSpeed, units)}{(() => {
              const factor = ipcjWindFactor(ipcjExposure, dayMonth, h.hour);
              if (factor <= 1.0) return null;
              const corrected = Math.round(h.windSpeed * factor);
              return <span className="ml-1 text-[10px] text-orange-500 dark:text-orange-400 font-medium">IPCJ: {fmtWind(corrected, units)}</span>;
            })()}
          </span>
          <span className="text-muted-foreground/50">({fmtTemp(h.temperature, units)} actual)</span>
        </div>
      )}
    </div>
  );
}


// ── Day Card ──────────────────────────────────────────────────────
function DayCard({ day, locationName, units, ipcjExposure }: {
  day: DayData;
  locationName?: string;
  units: UnitSystem;
  ipcjExposure: IpcjExposure;
}) {
  const [expanded, setExpanded] = useState(false);
  const bg = scoreBg(day.dayScore);
  const dayHours = day.hours.filter(h => h.isDay);

  return (
    <div className="border border-border rounded-2xl overflow-hidden transition-all bg-card">
      {/* Header — always visible */}
      <button
        data-testid={`day-card-${day.date}`}
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left p-4 flex items-start gap-4 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
      >
        {/* Date */}
        <div className="flex flex-col gap-0 shrink-0 w-10">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
            {day.isToday ? 'Today' : day.weekday}
          </div>
          <div className="text-xs font-medium text-foreground leading-tight">{day.dateLabel}</div>
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
              const dayMonth = new Date(day.date).getMonth() + 1;
              return <HourRow key={h.hour} h={h} units={units} ipcjExposure={ipcjExposure} dayMonth={dayMonth} />;
            })}
          </div>



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

// ── Intro Screen ─────────────────────────────────────────────────
function IntroScreen({ onDone }: { onDone: () => void }) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-between px-6 py-12">
      {/* Top: logo + name */}
      <div className="flex items-center gap-2.5 self-start">
        <svg viewBox="0 0 32 32" width="28" height="28" fill="none">
          <circle cx="16" cy="16" r="6" fill="#f59e0b" />
          {[0,60,120,180,240,300].map((deg: number) => {
            const rad = (deg * Math.PI) / 180;
            const x1 = 16 + 9 * Math.cos(rad), y1 = 16 + 9 * Math.sin(rad);
            const x2 = 16 + 13 * Math.cos(rad), y2 = 16 + 13 * Math.sin(rad);
            return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />;
          })}
        </svg>
        <span className="font-bold text-base tracking-tight">Solara</span>
      </div>

      {/* Centre: headline + copy */}
      <div className="flex flex-col gap-6 max-w-sm w-full">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold text-foreground leading-tight">
            Dialing in on sunny times.
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This app was designed for Superman. He absorbs sun radiation and uses it
            for his daily hero activities. All others using it should exercise caution
            and heed health authorities' recommendations on sun exposure.
          </p>
        </div>

        {/* CTA */}
        <button
          data-testid="btn-get-started"
          onClick={onDone}
          className="w-full h-12 rounded-xl bg-primary text-primary-foreground
            text-base font-semibold hover:bg-primary/90 transition-colors"
        >
          Get started
        </button>
      </div>

      <div />
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
            Dialing in on sunny times.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-2 leading-relaxed max-w-xs mx-auto">
            This app was designed for Superman. He absorbs sun radiation and uses it for his daily hero activities. All others using it should exercise caution and heed health authorities’ recommendations on sun exposure.
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
          <h2 className="text-base font-bold text-foreground">Afonso Sun-Lover Index</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 flex flex-col gap-6 text-sm">

          {/* Score labels */}
          <div>
            <h3 className="font-semibold text-foreground mb-1">Score labels</h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
              Each daylight hour is scored 0–100. The score reflects how good conditions are
              for being outdoors in the sun — combining light quality, warmth, and wind comfort.
            </p>
            <div className="flex flex-col gap-2.5">
              {[
                { label: "Prime sun",  range: "80–100", color: "#ea580c", desc: "Exceptional. High radiation, strong UV, warm temperature, low wind. Rare outside peak summer." },
                { label: "Good sun",   range: "65–79",  color: "#eab308", desc: "Solid conditions across all variables. Proper beach or terrace weather." },
                { label: "Fair sun",   range: "45–64",  color: "#fef08a", border: true, desc: "One variable is limiting — cold, partial cloud, or elevated wind. Still worth going out." },
                { label: "Weak sun",   range: "25–44",  color: "#d1d5db", desc: "Conditions are marginal. A clear cold winter day, or warm but overcast. Brief benefit only." },
                { label: "No sun",     range: "0–24",   color: "#e5e7eb", desc: "Overcast, rainy, foggy, or night. Score carries no meaningful signal." },
              ].map(s => (
                <div key={s.label} className="flex items-start gap-3">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                    style={{ backgroundColor: s.color, border: s.border ? '1px solid #ca8a04' : undefined }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-foreground">{s.label}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{s.range}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* How the score is built */}
          <div>
            <h3 className="font-semibold text-foreground mb-1">How the score is built</h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
              Four variables add up to a base score, then a wind multiplier scales the result down.
              No single variable can make or break the score — they work together.
            </p>
            <div className="flex flex-col gap-3">
              {[
                {
                  name: "Solar radiation", weight: "45 pts", icon: "⚡",
                  detail: "Direct W/m² reaching the ground. The heaviest term — it physically encodes cloud conditions and sun angle. Above 500 W/m² a saturation curve applies, compressing the top end so peak summer doesn't dominate."
                },
                {
                  name: "Cloud cover", weight: "15 pts", icon: "☁",
                  detail: "Lower weight than radiation to avoid double-penalising overcast hours — radiation already drops when cloud thickens. The cloud term captures partial coverage that radiation alone misses."
                },
                {
                  name: "UV index", weight: "15 pts", icon: "☀",
                  detail: "UV 0–10 scored linearly. When Open-Meteo returns no UV (common for historical dates), Solara estimates it from radiation and solar zenith angle with a seasonal correction."
                },
                {
                  name: "Feels-like temperature", weight: "25 pts", icon: "🌡",
                  detail: "Apparent temperature 10–40°C scored linearly. Below 10°C contributes zero — not because sun is absent, but because meaningful skin exposure becomes impractical. A clear 15°C winter day still scores well on the other three terms."
                },
              ].map(v => (
                <div key={v.name} className="flex items-start gap-3">
                  <div className="w-8 text-center text-base shrink-0 mt-0.5">{v.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-foreground">{v.name}</span>
                      <span className="text-[10px] text-muted-foreground">max {v.weight}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">{v.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Wind multiplier */}
            <div className="mt-4 bg-muted/40 rounded-xl p-3">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-xs font-semibold text-foreground">🌬 Wind multiplier</span>
                <span className="text-[10px] text-muted-foreground">scales the entire base score</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">
                Wind doesn't block UV — but it determines whether you'll actually stay outside.
                The multiplier is continuous, not stepped: penalties increase smoothly with speed.
              </p>
              <div className="flex flex-col gap-1">
                {[
                  { range: "≤ 15 km/h",  label: "No penalty",   mult: "×1.0", note: "Calm to gentle breeze. Beaufort 0–3." },
                  { range: "15–30 km/h", label: "Mild penalty",  mult: "×1.0→0.7", note: "Moderate breeze. Noticeable but manageable." },
                  { range: "30–50 km/h", label: "Strong penalty",mult: "×0.7→0.4", note: "Fresh to strong breeze. Extended stays unlikely." },
                  { range: "> 50 km/h",  label: "Severe",        mult: "×0.3", note: "Near gale. Most people will not stay out." },
                ].map(r => (
                  <div key={r.range} className="flex items-center gap-2 text-[10px]">
                    <span className="font-mono text-muted-foreground w-20 shrink-0">{r.range}</span>
                    <span className="font-semibold text-foreground w-12 shrink-0">{r.mult}</span>
                    <span className="text-muted-foreground">{r.note}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Corrections */}
          <div>
            <h3 className="font-semibold text-foreground mb-1">Automatic corrections</h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
              Raw weather model data has known biases for specific locations and conditions.
              Solara applies three corrections silently — no settings required.
            </p>
            <div className="flex flex-col gap-4">

              <div>
                <div className="text-xs font-semibold text-foreground mb-0.5">Nortada wind (IPCJ)</div>
                <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">
                  ERA5 — the model behind Open-Meteo — runs at ~31 km resolution and
                  systematically underestimates the Iberian Coastal Low-Level Jet (the Nortada),
                  a persistent northerly along Portugal's Atlantic coast present on ~70% of summer days,
                  with model underestimates of 7–14 km/h at the coast.
                  (Soares et al., 2014; DIVA-Portal 2014)
                </p>
                <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">
                  Solara classifies each location automatically and multiplies the reported wind
                  before scoring. The corrected value appears as{' '}
                  <span className="text-orange-500 font-medium">IPCJ: xx km/h</span> in each hour row
                  and in the accuracy board.
                </p>
                {/* Location tiers */}
                <div className="flex flex-col gap-1 mb-2">
                  {[
                    { tier: 'High exposure', color: 'bg-orange-500', desc: 'West-Atlantic-facing beaches directly in the jet path: Costa Vicentina, Nazaré, Figueira, Costa Nova, Praia de Mira, Costa da Caparica, Guincho, Ofir, Matosinhos.' },
                    { tier: 'Medium exposure', color: 'bg-yellow-400', desc: 'Partially sheltered: Arrábida, Sesimbra, Tróia, southwest tip (Sagres area).' },
                    { tier: 'No correction', color: 'bg-gray-300', desc: 'Algarve south coast, Madeira, Açores, inland locations.' },
                  ].map(t => (
                    <div key={t.tier} className="flex items-start gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${t.color}`} />
                      <div className="text-[10px] text-muted-foreground leading-relaxed">
                        <span className="font-semibold text-foreground">{t.tier} — </span>{t.desc}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Multiplier table */}
                <div className="bg-muted/40 rounded-xl overflow-hidden">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-2 py-1.5 font-semibold text-foreground">Season</th>
                        <th className="text-left px-2 py-1.5 font-semibold text-foreground">Hours</th>
                        <th className="text-center px-2 py-1.5 font-semibold text-orange-600">High</th>
                        <th className="text-center px-2 py-1.5 font-semibold text-yellow-600">Medium</th>
                      </tr>
                    </thead>
                    <tbody className="text-muted-foreground">
                      {[
                        { season: 'Jun–Sep', hours: '13h–20h', high: '×1.40', med: '×1.25' },
                        { season: 'Jun–Sep', hours: '07h–12h', high: '×1.15', med: '×1.10' },
                        { season: 'Jun–Sep', hours: 'other',    high: '×1.10', med: '×1.05' },
                        { season: 'Apr–May, Oct', hours: '13h–20h', high: '×1.20', med: '×1.12' },
                        { season: 'Apr–May, Oct', hours: 'other',    high: '×1.10', med: '×1.05' },
                        { season: 'Nov–Mar', hours: 'any',      high: '×1.05', med: '×1.02' },
                      ].map((r, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                          <td className="px-2 py-1">{r.season}</td>
                          <td className="px-2 py-1 font-mono">{r.hours}</td>
                          <td className="px-2 py-1 text-center font-semibold text-foreground">{r.high}</td>
                          <td className="px-2 py-1 text-center font-semibold text-foreground">{r.med}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-foreground mb-0.5">Radiation saturation</div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Above 500 W/m², the subjective benefit of more direct sun plateaus — 600 vs 750 W/m²
                  feels similar to a sun-lover. A linear model would over-reward peak August
                  over a clear April afternoon. Above 500 W/m² Solara applies a square-root
                  compression, so 800 W/m² maps to ~680 effective W/m².
                </p>
              </div>

              <div>
                <div className="text-xs font-semibold text-foreground mb-0.5">UV fallback estimate</div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Open-Meteo's forecast API sometimes returns null UV. When that happens, Solara
                  estimates UV from direct radiation using a zenith-angle weight (peaks at solar noon)
                  and a seasonal efficiency factor — summer ozone over Iberia is thinner,
                  yielding more UV per W/m².
                </p>
              </div>
            </div>
          </div>

          {/* Data source */}
          <div className="border-t border-border pt-4">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Weather data from <span className="text-foreground font-medium">Open-Meteo</span> (ERA5-backed forecast and archive APIs).
              Location search via <span className="text-foreground font-medium">Nominatim / OpenStreetMap</span>.
              Wind correction: Soares et al., 2014, Univ. Lisbon; DIVA-Portal IPCJ Climatology, 2014.
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

// ── Accuracy Section ──────────────────────────────────────────────
function AccuracySection({ lat, lon, units, ipcjExposure }: { lat: number; lon: number; units: UnitSystem; ipcjExposure: IpcjExposure }) {
  const [open, setOpen] = useState(false);

  const { data: rows, isLoading, isError } = useQuery<DayAccuracy[]>({
    queryKey: ['accuracy', lat, lon],
    queryFn: () => fetchActualScores(lat, lon),
    enabled: open,
    staleTime: 1000 * 60 * 60,
    retry: 1,
  });

  function delta(a: number, f: number, invert = false) {
    const d = Math.round((a - f) * 10) / 10;
    if (d === 0) return <span className="text-muted-foreground/40">—</span>;
    // For cloud and wind: positive delta (actual higher) is bad → show orange
    // For rad, UV, temp: positive delta (actual higher) is good → show green
    const isGood = invert ? d < 0 : d > 0;
    const sign = d > 0 ? '+' : '';
    return (
      <span className={isGood
        ? 'text-emerald-600 dark:text-emerald-400 font-medium'
        : 'text-orange-500 dark:text-orange-400 font-medium'}>
        {sign}{d}
      </span>
    );
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
        <div className="flex flex-col gap-2">
          {isLoading && <Skeleton className="h-40 rounded-xl" />}
          {isError && <p className="text-xs text-muted-foreground">Could not load historical data.</p>}
          {rows && rows.length > 0 && (
            <div className="flex flex-col gap-2">
              {rows.map(row => {
                const h = row.bestHour;
                const hourLabel = `${String(h.hour).padStart(2, '0')}:00`;
                const scoreD = h.aScore - h.fScore;
                const scoreDStr = scoreD === 0 ? '—' : (scoreD > 0 ? `+${scoreD}` : `${scoreD}`);
                const scoreDColor = scoreD > 5 ? 'text-emerald-600 dark:text-emerald-400'
                  : scoreD < -5 ? 'text-orange-500 dark:text-orange-400'
                  : 'text-muted-foreground/60';
                return (
                  <div key={row.date} className="bg-card border border-border rounded-xl overflow-hidden">
                    {/* Header: date + best hour + score comparison */}
                    <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">{row.weekday}</span>
                        <span className="text-[10px] text-muted-foreground">{row.date}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">best hour: {hourLabel}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">forecast <span className={scoreColor(h.fScore)}>{h.fScore}</span></span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-muted-foreground">actual <span className={scoreColor(h.aScore)}>{h.aScore}</span></span>
                        <span className={`font-semibold text-[10px] ${scoreDColor}`}>{scoreDStr}</span>
                      </div>
                    </div>
                    {/* Variable comparison grid */}
                    {(() => {
                      const month = new Date(row.date).getMonth() + 1;
                      const ipcjFactor = ipcjWindFactor(ipcjExposure, month, h.hour);
                      const fWindIpcj = Math.round(h.fWind * ipcjFactor);
                      const hasIpcj = ipcjFactor > 1.0;
                      const cols = [
                        { label: '⚡ Rad',   f: `${h.fRad}`,            a: `${h.aRad}`,            d: delta(h.aRad, h.fRad) },
                        { label: '☁ Cloud', f: `${h.fCloud}%`,          a: `${h.aCloud}%`,          d: delta(h.aCloud, h.fCloud, true) },
                        { label: '☀ UV',    f: `${h.fUV}`,             a: `${h.aUV}`,             d: delta(h.aUV, h.fUV) },
                        { label: '🌡 Temp', f: fmtTemp(h.fTemp, units), a: fmtTemp(h.aTemp, units), d: delta(h.aTemp, h.fTemp) },
                      ];
                      return (
                        <div className="grid text-[10px]" style={{ gridTemplateColumns: `repeat(4, 1fr) ${hasIpcj ? '1.6fr' : '1fr'}` }}>
                          {cols.map(v => (
                            <div key={v.label} className="flex flex-col items-center gap-0.5 px-1 py-2 border-r border-border">
                              <span className="text-muted-foreground font-medium mb-1">{v.label}</span>
                              <span className="text-muted-foreground/60">fcst</span>
                              <span className="text-foreground font-medium">{v.f}</span>
                              <span className="text-muted-foreground/60 mt-1">actual</span>
                              <span className="text-foreground font-medium">{v.a}</span>
                              <span className="mt-1">{v.d}</span>
                            </div>
                          ))}
                          {/* Wind — expanded to show raw + IPCJ */}
                          <div className="flex flex-col items-center gap-0.5 px-1 py-2">
                            <span className="text-muted-foreground font-medium mb-1">🌬 Wind</span>
                            <span className="text-muted-foreground/60">fcst</span>
                            <span className="text-foreground font-medium">{fmtWind(h.fWind, units)}</span>
                            {hasIpcj && (
                              <>
                                <span className="text-orange-500/70 mt-0.5">+IPCJ</span>
                                <span className="text-orange-500 font-medium">{fmtWind(fWindIpcj, units)}</span>
                              </>
                            )}
                            <span className="text-muted-foreground/60 mt-1">actual</span>
                            <span className="text-foreground font-medium">{fmtWind(h.aWind, units)}</span>
                            <span className="mt-1">{delta(h.aWind, h.fWind, true)}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
              <p className="text-[10px] text-muted-foreground/50 text-center">
                Forecast: Open-Meteo forecast model · Actual: ERA5 reanalysis archive · Delta = actual − forecast
              </p>
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
  const [units, setUnits] = useState<UnitSystem>('metric');
  const [introDone, setIntroDone] = useState<boolean | null>(null);
  const [ipcjExposure, setIpcjExposure] = useState<IpcjExposure>('none');
  const qc = useQueryClient();

  // Load saved preferences on mount
  const { data: unitsPref } = useQuery<{ value: string | null }>({
    queryKey: ['/api/prefs/units'],
    staleTime: Infinity,
  });
  const { data: introPref } = useQuery<{ value: string | null }>({
    queryKey: ['/api/prefs/intro_done'],
    staleTime: Infinity,
  });
  useEffect(() => {
    if (unitsPref?.value === 'imperial') setUnits('imperial');
  }, [unitsPref]);
  useEffect(() => {
    if (introPref !== undefined) {
      setIntroDone(introPref?.value === '1');
    }
  }, [introPref]);

  const toggleUnits = useCallback(() => {
    const next: UnitSystem = units === 'metric' ? 'imperial' : 'metric';
    setUnits(next);
    apiRequest('POST', '/api/prefs/units', { value: next });
  }, [units]);

  // Auto-classify IPCJ exposure whenever location changes — fully automatic
  useEffect(() => {
    if (location) {
      setIpcjExposure(defaultIpcjExposure(location.lat, location.lon));
    }
  }, [location?.lat, location?.lon]);

  const { data, isLoading, isError, refetch } = useQuery<SunForecast>({
    queryKey: ['sun', location?.lat, location?.lon, ipcjExposure],
    queryFn: () => fetchSunForecast(location!.lat, location!.lon, location!.name, ipcjExposure),
    enabled: !!location,
    staleTime: 1000 * 60 * 30,
    retry: 1,
  });

  const saveFavouriteMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/favourites', {
      name: location!.name,
      lat: location!.lat,
      lon: location!.lon,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/favourites'] }),
  });

  // Still loading prefs — show nothing to avoid flash
  if (introDone === null) return null;

  if (!introDone) {
    return <IntroScreen onDone={() => {
      setIntroDone(true);
      apiRequest('POST', '/api/prefs/intro_done', { value: '1' });
    }} />;
  }

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
              <span className="hidden sm:inline">Sun-Lover Index</span>
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
                  units={units}
                  ipcjExposure={ipcjExposure}
                />
              ))}
            </div>

            {/* Accuracy */}
            <AccuracySection
              lat={location.lat}
              lon={location.lon}
              units={units}
              ipcjExposure={ipcjExposure}
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
