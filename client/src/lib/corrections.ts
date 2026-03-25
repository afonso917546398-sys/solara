// ── Solara — Environmental Corrections ───────────────────────────
// Science-based adjustments applied on top of raw Open-Meteo data
// before the Solara Index is computed.

// ─────────────────────────────────────────────────────────────────
// 1. IPCJ COASTAL WIND CORRECTION
// ─────────────────────────────────────────────────────────────────
//
// The Iberian Peninsula Coastal Low-Level Jet (IPCJ), locally known
// as the Nortada, is a persistent northerly wind feature along the
// west-facing Atlantic coast of Portugal driven by the Azores High,
// coastal topography and ocean-land thermal contrast.
//
// ERA5 (Open-Meteo's backbone) operates at ~31km resolution and
// systematically underestimates the IPCJ, which is a mesoscale
// feature with a core width of 50–100km. Studies using 9km downscaling
// (Soares et al., 2014, Univ. Lisbon; IPCJ climatology, DIVA-Portal
// 2014) find the jet present on ~70% of summer days and ERA5
// underestimating peak speeds by 2–4 m/s (7–14 km/h) at the coast.
//
// Correction: multiply reported wind speed by a factor based on
// location type, month, and hour.
//
// Location types:
//   'ipcj_high'   West-Atlantic-facing beaches, directly in jet path
//                 (Costa Vicentina, Centro coast, Porto & Norte beaches)
//   'ipcj_medium' Partially sheltered or oblique-angle exposure
//                 (some Setúbal/Arrábida, Costa de Lisboa)
//   'none'        Algarve south-facing, inland, Madeira, Açores

export type IpcjExposure = 'high' | 'medium' | 'none';

// Month: 1=Jan...12=Dec. Hour: 0-23.
export function ipcjWindFactor(
  exposure: IpcjExposure,
  month: number,
  hour: number
): number {
  if (exposure === 'none') return 1.0;

  // Jet is strongest June–September, peaking in afternoon (14h–19h)
  const isSummer    = month >= 6 && month <= 9;
  const isSpringFall = (month >= 4 && month <= 5) || (month >= 10 && month <= 10);
  const isAfternoon = hour >= 13 && hour <= 20;
  const isMorning   = hour >= 7 && hour <= 12;

  if (exposure === 'high') {
    if (isSummer && isAfternoon)   return 1.40; // +40% — peak IPCJ conditions
    if (isSummer && isMorning)     return 1.15; // +15% — jet building
    if (isSummer)                  return 1.10; // evening/early, some residual
    if (isSpringFall && isAfternoon) return 1.20;
    if (isSpringFall)              return 1.10;
    return 1.05; // winter: small residual bias
  }

  if (exposure === 'medium') {
    if (isSummer && isAfternoon)   return 1.25;
    if (isSummer && isMorning)     return 1.10;
    if (isSummer)                  return 1.05;
    if (isSpringFall && isAfternoon) return 1.12;
    if (isSpringFall)              return 1.05;
    return 1.02;
  }

  return 1.0;
}

// ─────────────────────────────────────────────────────────────────
// 2. UV INDEX FALLBACK (when archive returns null)
// ─────────────────────────────────────────────────────────────────
//
// Open-Meteo's archive API does not always return uv_index for
// historical dates. When null, estimating UV purely from radiation
// loses the solar zenith angle: the same W/m² at 9am is geometrically
// less intense UV than at solar noon.
//
// Correction: scale estimated UV by time-of-day weight that peaks
// at solar noon (13h in Portugal with summer DST) and falls off
// toward sunrise/sunset using a cosine-like curve.
//
// Calibration: at solar noon in Iberia:
//   Summer (Jun–Aug): UV ~9–10 at 800 W/m²
//   Spring/Autumn:    UV ~6–7  at 700 W/m²
//   Winter:           UV ~3–4  at 400 W/m²
// Source: WHO UV Index scale; IPMA historical UV data for Portugal.

export function estimateUV(
  directRadiation: number,
  hour: number,
  month: number
): number {
  if (directRadiation <= 0) return 0;

  // Solar noon weight: peaks at 13h (Portugal DST-adjusted noon)
  // cos curve: 0 at 6h and 20h, 1.0 at 13h
  const solarNoonHour = 13;
  const halfDay = 7; // hours from dawn to noon
  const angle = Math.abs(hour - solarNoonHour) / halfDay;
  const zenithWeight = Math.max(0, Math.cos(angle * Math.PI / 2));

  // Seasonal UV efficiency (UV per W/m² at solar noon)
  // Summer ozone is thinner over Iberia, more UV per W/m²
  const isSummer    = month >= 6 && month <= 8;
  const isSpring    = month >= 4 && month <= 5;
  const isAutumn    = month >= 9 && month <= 10;
  const uvPerWatt   = isSummer ? 0.012
                    : isSpring || isAutumn ? 0.009
                    : 0.007; // winter

  const rawUV = directRadiation * uvPerWatt * zenithWeight;
  return Math.round(Math.min(12, rawUV) * 10) / 10;
}

// ─────────────────────────────────────────────────────────────────
// 3. RADIATION SATURATION (sqrt curve above 500 W/m²)
// ─────────────────────────────────────────────────────────────────
//
// The subjective benefit of direct radiation plateaus for a sun-lover
// once you're in full blazing sun. 600 vs 750 W/m² feels similar;
// the linear model over-rewards peak summer vs spring.
//
// Correction: linear below 500 W/m², sqrt-smoothed above.
// Result: 800 W/m² maps to ~680 "effective W/m²" instead of 800,
// compressing the top end without eliminating the peak signal.

export function effectiveRadiation(rad: number): number {
  if (rad <= 500) return rad;
  // sqrt blend above 500: preserves rank ordering but compresses range
  const excess = rad - 500;
  const compressed = Math.sqrt(excess / 300) * 180; // max +180 above 500
  return Math.min(800, 500 + compressed);
}
