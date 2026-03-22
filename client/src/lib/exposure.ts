// ── Vitamin D Exposure Calculator ────────────────────────────────
//
// Based on the Fitzpatrick skin type scale and the relationship between
// UV Index and minimal erythemal dose (MED).
//
// Formula: exposure_minutes = (MED_factor / UV_index) * skin_multiplier
//
// MED reference: WHO, CIE, and Lucas et al. (2006) "Measured and modelled
// UV doses at a location in southeastern Australia"
// Rule of thumb baseline: ~15 min at UV 3 for Fitzpatrick II (fair skin)
// to produce a meaningful vitamin D dose (roughly 1/4 MED to arms+face).
//
// Skin multiplier derived from Holick MF (2007) "Vitamin D Deficiency"
// NEJM 357:266–281 — darker skin requires proportionally more UV exposure.

export interface SkinType {
  id: number;           // Fitzpatrick I–VI
  label: string;
  description: string;
  multiplier: number;   // relative to type II baseline
}

export const SKIN_TYPES: SkinType[] = [
  { id: 1, label: "Type I",   description: "Very fair, always burns, never tans",       multiplier: 0.7  },
  { id: 2, label: "Type II",  description: "Fair, usually burns, sometimes tans",        multiplier: 1.0  },
  { id: 3, label: "Type III", description: "Medium, sometimes burns, always tans",       multiplier: 1.4  },
  { id: 4, label: "Type IV",  description: "Olive, rarely burns, always tans",           multiplier: 2.0  },
  { id: 5, label: "Type V",   description: "Brown, very rarely burns",                   multiplier: 2.8  },
  { id: 6, label: "Type VI",  description: "Dark brown/black, never burns",              multiplier: 4.0  },
];

// Minimum meaningful UV dose for vitamin D (arms + face exposed, ~25% body)
// at UV Index 3 for Fitzpatrick II = ~15 minutes (WHO guideline baseline)
const BASE_MINUTES_UV3_TYPE2 = 15;

/**
 * Calculate recommended exposure minutes for a meaningful vitamin D dose.
 * Returns null if UV is too low to produce D3 (UV < 3).
 */
export function calcExposureMinutes(uvIndex: number, skinTypeId: number): number | null {
  if (uvIndex < 3) return null; // No UVB synthesis possible below UV 3

  const skin = SKIN_TYPES.find(s => s.id === skinTypeId) ?? SKIN_TYPES[1];

  // Scale inversely with UV — higher UV = less time needed
  const minutes = (BASE_MINUTES_UV3_TYPE2 / (uvIndex / 3)) * skin.multiplier;

  return Math.round(Math.max(3, Math.min(120, minutes)));
}

/**
 * Find the best hour to go out for vitamin D on a given day.
 * Picks the qualifying hour with the highest sun score (already computed).
 */
export function bestExposureHour(
  hours: { hour: number; timeLabel: string; uvIndex: number; sunScore: number; isDay: number }[]
): { timeLabel: string; uvIndex: number } | null {
  const candidates = hours
    .filter(h => h.isDay && h.uvIndex >= 3 && h.sunScore > 30)
    .sort((a, b) => b.sunScore - a.sunScore);

  return candidates[0] ?? null;
}
