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
import type { Favourite } from "@/lib/localStore";
import { useLang, LangToggle } from "@/lib/i18n";
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
  const { s } = useLang();
  const pct = h.isDay ? h.sunScore : 0;
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg text-sm transition-colors hover:bg-muted/50">
      {/* Top row: time + bar + score */}
      <div className="flex items-center gap-3">
        <div className="w-9 shrink-0">
          <span className="font-mono text-[10px] text-muted-foreground">{h.timeLabel}</span>
        </div>
        <div className="flex-1 h-3 bg-border rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${pct > 0 ? hourBarColor(pct) : ''}`}
            style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-sm font-bold w-7 text-right shrink-0 ${scoreColor(h.sunScore)}`}>
          {h.isDay ? h.sunScore : '—'}
        </span>
      </div>
      {/* Raw variables row — only during daylight, ordered by score weight: radiation, cloud, UV, temp, wind */}
      {h.isDay && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-[48px] text-xs text-muted-foreground">
          <span className="flex items-center gap-0.5" title={s.titleRadiation}>
            ⚡ {Math.round(h.directRadiation)} W/m²
          </span>
          <span className="flex items-center gap-0.5" title={s.titleCloud}>
            <Cloud size={11} />{h.cloudCover}%
          </span>
          <span className="flex items-center gap-0.5" title={s.titleUV}>
            <Sun size={11} />UV {h.uvIndex.toFixed(1)}
          </span>
          <span className="flex items-center gap-0.5" title={s.titleFeels}>
            <Thermometer size={11} />{s.feelsLike(fmtTemp(h.apparentTemp, units))}
          </span>
          <span className="flex items-center gap-0.5" title={s.titleWind}>
            <Wind size={11} />{fmtWind(h.windSpeed, units)}{(() => {
              const factor = ipcjWindFactor(ipcjExposure, dayMonth, h.hour);
              if (factor <= 1.0) return null;
              const corrected = Math.round(h.windSpeed * factor);
              return <span className="ml-1 text-[10px] text-muted-foreground">IPCJ: {fmtWind(corrected, units)}</span>;
            })()}
          </span>
          <span className="text-muted-foreground/50">{s.actualTemp(fmtTemp(h.temperature, units))}</span>
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
  const { s } = useLang();
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
            {day.isToday ? s.today : day.weekday}
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
  const { s } = useLang();
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-between px-6 py-12">
      {/* Top: logo + name + language toggle */}
      <div className="w-full flex items-center justify-between">
      <div className="flex items-center gap-2.5">
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
      <LangToggle />
      </div>

      {/* Centre: headline + copy */}
      <div className="flex flex-col gap-6 max-w-sm w-full">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold text-foreground leading-tight">
            {s.tagline}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {s.pitch}
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {s.superman1} {s.superman2}
          </p>
        </div>

        {/* CTA */}
        <button
          data-testid="btn-get-started"
          onClick={onDone}
          className="w-full h-12 rounded-xl bg-primary text-primary-foreground
            text-base font-semibold hover:bg-primary/90 transition-colors"
        >
          {s.getStarted}
        </button>
      </div>

      <div />
    </div>
  );
}

// ── Location Gate ─────────────────────────────────────────────────
function LocationGate({ onLocation, onAbout }: { onLocation: (lat: number, lon: number, name: string) => void; onAbout: () => void }) {
  const { s } = useLang();
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
        setGpsError(s.gpsError);
      },
      { timeout: 8000, maximumAge: 60000 }
    );
  }, [onLocation, s]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background relative">
      <LangToggle className="absolute top-4 right-4" />
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
            {s.tagline}
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed mt-1">
            {s.pitch}
          </p>
          <p className="text-xs text-muted-foreground/70 mt-2 leading-relaxed max-w-xs mx-auto">
            {s.superman1}
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1 leading-relaxed max-w-xs mx-auto">
            {s.superman2}
          </p>
        </div>

        {/* About score link */}
        <button
          onClick={onAbout}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Info size={13} />
          {s.aboutScore}
        </button>

        {/* City search — primary */}
        <div className="w-full flex flex-col gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              ref={inputRef}
              data-testid="input-city-search"
              type="text"
              placeholder={s.searchPlaceholder}
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
                  <RefreshCw size={13} className="animate-spin" /> {s.searching}
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
          <span className="text-xs text-muted-foreground">{s.or}</span>
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
            <><RefreshCw size={14} className="mr-2 animate-spin" />{s.detecting}</>
          ) : (
            <><MapPin size={14} className="mr-2" />{s.useGps}</>
          )}
        </Button>

        {gpsError && (
          <p className="text-xs text-muted-foreground text-center">{gpsError}</p>
        )}

        <p className="text-xs text-muted-foreground text-center">
          {s.privacyNote}
        </p>

        {/* Saved locations — shown to returning users */}
        <FavouritesList onSelect={onLocation} />
      </div>
    </div>
  );
}

function FavouritesList({ onSelect }: { onSelect: (lat: number, lon: number, name: string) => void }) {
  const { s } = useLang();
  const { data: favs = [] } = useQuery<Favourite[]>({
    queryKey: ['/api/favourites'],
    staleTime: 0,
  });

  if (favs.length === 0) return null;

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground">{s.savedPlaces}</span>
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
  const { s } = useLang();
  const a = s.about;
  // Presentation data zipped by index with the translated arrays in i18n.ts
  const scoreColors = [
    { color: "#ea580c" },
    { color: "#eab308" },
    { color: "#fef08a", border: true },
    { color: "#d1d5db" },
    { color: "#e5e7eb" },
  ];
  const variableIcons = ["⚡", "☁", "☀", "🌡"];
  const tierColors = ["bg-orange-500", "bg-yellow-400", "bg-gray-300"];
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto
        shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
          <h2 className="text-base font-bold text-foreground">{a.title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 flex flex-col gap-6 text-sm">

          {/* Score labels */}
          <div>
            <h3 className="font-semibold text-foreground mb-1">{a.scoreLabelsTitle}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
              {a.scoreLabelsIntro}
            </p>
            <div className="flex flex-col gap-2.5">
              {a.scoreLabels.map((sl, i) => (
                <div key={sl.label} className="flex items-start gap-3">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                    style={{ backgroundColor: scoreColors[i].color, border: scoreColors[i].border ? '1px solid #ca8a04' : undefined }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-foreground">{sl.label}</span>
                      <span className="text-xs text-muted-foreground font-mono">{sl.range}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{sl.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* How the score is built */}
          <div>
            <h3 className="font-semibold text-foreground mb-1">{a.howBuiltTitle}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
              {a.howBuiltIntro}
            </p>
            <div className="flex flex-col gap-3">
              {a.variables.map((v, i) => (
                <div key={v.name} className="flex items-start gap-3">
                  <div className="w-8 text-center text-base shrink-0 mt-0.5">{variableIcons[i]}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-foreground">{v.name}</span>
                      <span className="text-xs text-muted-foreground">{a.maxLabel} {v.weight}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{v.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Wind multiplier */}
            <div className="mt-4 bg-muted/40 rounded-xl p-3">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-xs font-semibold text-foreground">{a.windTitle}</span>
                <span className="text-xs text-muted-foreground">{a.windSub}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                {a.windBody}
              </p>
              <div className="flex flex-col gap-1">
                {a.windRows.map(r => (
                  <div key={r.range} className="flex items-center gap-2 text-xs">
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
            <h3 className="font-semibold text-foreground mb-1">{a.correctionsTitle}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
              {a.correctionsIntro}
            </p>
            <div className="flex flex-col gap-4">

              <div>
                <div className="text-xs font-semibold text-foreground mb-0.5">{a.nortadaTitle}</div>
                <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                  {a.nortadaP1}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                  {a.nortadaP2a}
                  <span className="text-orange-500 font-medium">IPCJ: xx km/h</span>
                  {a.nortadaP2b}
                </p>
                {/* Location tiers */}
                <div className="flex flex-col gap-1 mb-2">
                  {a.tiers.map((t, i) => (
                    <div key={t.tier} className="flex items-start gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${tierColors[i]}`} />
                      <div className="text-xs text-muted-foreground leading-relaxed">
                        <span className="font-semibold text-foreground">{t.tier} — </span>{t.desc}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Multiplier table */}
                <div className="bg-muted/40 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-2 py-1.5 font-semibold text-foreground">{a.tableSeason}</th>
                        <th className="text-left px-2 py-1.5 font-semibold text-foreground">{a.tableHours}</th>
                        <th className="text-center px-2 py-1.5 font-semibold text-orange-600">{a.tableHigh}</th>
                        <th className="text-center px-2 py-1.5 font-semibold text-yellow-600">{a.tableMedium}</th>
                      </tr>
                    </thead>
                    <tbody className="text-muted-foreground">
                      {a.tableRows.map((r, i) => (
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
                <div className="text-xs font-semibold text-foreground mb-0.5">{a.saturationTitle}</div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {a.saturationBody}
                </p>
              </div>

              <div>
                <div className="text-xs font-semibold text-foreground mb-0.5">{a.uvFallbackTitle}</div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {a.uvFallbackBody}
                </p>
              </div>
            </div>
          </div>

          {/* Data source */}
          <div className="border-t border-border pt-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {a.dataSource1}<span className="text-foreground font-medium">Open-Meteo</span>
              {a.dataSource2}<span className="text-foreground font-medium">Nominatim / OpenStreetMap</span>
              {a.dataSource3}
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
  const { s } = useLang();
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
          <Star size={11} />{s.save} {current.name}
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
  const { s, lang, locale } = useLang();
  const [open, setOpen] = useState(false);

  const { data: rows, isLoading, isError } = useQuery<DayAccuracy[]>({
    queryKey: ['accuracy', lat, lon, lang],
    queryFn: () => fetchActualScores(lat, lon, locale),
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
        {s.accuracyTitle}
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="flex flex-col gap-2">
          {isLoading && <Skeleton className="h-40 rounded-xl" />}
          {isError && <p className="text-xs text-muted-foreground">{s.accuracyError}</p>}
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
                        <span className="text-muted-foreground">{s.bestHour} {hourLabel}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">{s.forecast} <span className={scoreColor(h.fScore)}>{h.fScore}</span></span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-muted-foreground">{s.actual} <span className={scoreColor(h.aScore)}>{h.aScore}</span></span>
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
                        { label: s.colRad,   f: `${h.fRad}`,            a: `${h.aRad}`,            d: delta(h.aRad, h.fRad) },
                        { label: s.colCloud, f: `${h.fCloud}%`,          a: `${h.aCloud}%`,          d: delta(h.aCloud, h.fCloud, true) },
                        { label: s.colUV,    f: `${h.fUV}`,             a: `${h.aUV}`,             d: delta(h.aUV, h.fUV) },
                        { label: s.colTemp, f: fmtTemp(h.fTemp, units), a: fmtTemp(h.aTemp, units), d: delta(h.aTemp, h.fTemp) },
                      ];
                      return (
                        <div className="grid text-[10px]" style={{ gridTemplateColumns: `repeat(4, 1fr) ${hasIpcj ? '1.6fr' : '1fr'}` }}>
                          {cols.map(v => (
                            <div key={v.label} className="flex flex-col items-center gap-0.5 px-1 py-2 border-r border-border">
                              <span className="text-muted-foreground font-medium mb-1">{v.label}</span>
                              <span className="text-muted-foreground/60">{s.fcstShort}</span>
                              <span className="text-foreground font-medium">{v.f}</span>
                              <span className="text-muted-foreground/60 mt-1">{s.actualShort}</span>
                              <span className="text-foreground font-medium">{v.a}</span>
                              <span className="mt-1">{v.d}</span>
                            </div>
                          ))}
                          {/* Wind — expanded to show raw + IPCJ */}
                          <div className="flex flex-col items-center gap-0.5 px-1 py-2">
                            <span className="text-muted-foreground font-medium mb-1">{s.colWind}</span>
                            <span className="text-muted-foreground/60">{s.fcstShort}</span>
                            <span className="text-foreground font-medium">{fmtWind(h.fWind, units)}</span>
                            {hasIpcj && (
                              <>
                                <span className="text-orange-500/70 mt-0.5">+IPCJ</span>
                                <span className="text-orange-500 font-medium">{fmtWind(fWindIpcj, units)}</span>
                              </>
                            )}
                            <span className="text-muted-foreground/60 mt-1">{s.actualShort}</span>
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
                {s.accuracyFootnote}
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
  const { s, lang, locale } = useLang();
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
    queryKey: ['sun', location?.lat, location?.lon, ipcjExposure, lang],
    queryFn: () => fetchSunForecast(location!.lat, location!.lon, location!.name, ipcjExposure, locale),
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
    return (
      <>
        {aboutOpen && <AboutPanel onClose={() => setAboutOpen(false)} />}
        <LocationGate onLocation={(lat, lon, name) => setLocation({ lat, lon, name })} onAbout={() => setAboutOpen(true)} />
      </>
    );
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

            <LangToggle />
            <button
              data-testid="btn-toggle-units"
              onClick={toggleUnits}
              className="text-xs font-medium text-muted-foreground hover:text-foreground
                transition-colors px-2 py-1 rounded-lg hover:bg-accent"
              title={s.toggleUnits}
            >
              {units === 'metric' ? '°C' : '°F'}
            </button>
            <button
              data-testid="btn-about"
              onClick={() => setAboutOpen(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title={s.aboutScore}
            >
              <Info size={14} />
              <span className="hidden sm:inline">{s.solaraIndex}</span>
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
            <p className="text-sm text-muted-foreground">{s.loadError}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw size={14} className="mr-1.5" />{s.tryAgain}
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
        <span>{s.weatherLabel} <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">Open-Meteo</a> (CC BY 4.0)</span>
        <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
          {s.createdWith}
        </a>
      </footer>
    </div>
  );
}