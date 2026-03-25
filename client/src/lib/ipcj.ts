// ── IPCJ Exposure Classification ─────────────────────────────────
// Pre-assigns IPCJ exposure level to each location based on
// geographic position relative to the Portuguese Atlantic coast.
//
// Rules (based on Soares et al. 2014 IPCJ climatology):
//   high   — west-Atlantic-facing, <30km from open ocean, lat 37°–42°N
//   medium — partially sheltered, oblique exposure, or cape-shadow zones
//   none   — Algarve (south-facing), Madeira, Açores, inland locations
//
// Users can override per-location via the toggle in the app.

import type { IpcjExposure } from './corrections';

// Lat/lon bounding boxes for automatic classification
// Returns the default IPCJ exposure for a given coordinate

export function defaultIpcjExposure(lat: number, lon: number): IpcjExposure {
  // Açores: scattered Atlantic islands, no IPCJ
  if (lon < -20) return 'none';

  // Madeira: south of main IPCJ corridor
  if (lat < 33.5) return 'none';

  // Algarve south coast: roughly below 37.2°N and east of -8.8°W
  // (south-facing coast, jet wraps around but weakens significantly)
  if (lat < 37.2 && lon > -8.8) return 'none';

  // Southwest tip (Sagres/Martinhal area) — exposed to both W and S
  if (lat < 37.1 && lon < -8.8) return 'medium';

  // Costa Vicentina: fully exposed west-facing, classic IPCJ corridor
  if (lat >= 37.1 && lat <= 37.6 && lon <= -8.7) return 'high';

  // Algarve west (Arrifana, Bordeira, Amado) — exposed
  if (lat >= 37.2 && lat <= 37.4 && lon <= -8.7) return 'high';

  // Setúbal/Arrábida: partially sheltered by Arrábida ridge
  if (lat >= 38.4 && lat <= 38.55 && lon >= -9.1 && lon <= -8.9) return 'medium';

  // Tróia peninsula: west-facing but in estuary, medium
  if (lat >= 38.4 && lat <= 38.55 && lon >= -8.95 && lon <= -8.85) return 'medium';

  // Costa de Lisboa (Guincho, Cascais, Caparica) — exposed
  if (lat >= 38.5 && lat <= 38.8 && lon <= -9.1) return 'high';

  // Sesimbra — somewhat sheltered by headland
  if (lat >= 38.4 && lat <= 38.5 && lon >= -9.12 && lon <= -9.0) return 'medium';

  // Centro coast: Nazaré, S. Martinho, Figueira, Mira, Costa Nova
  if (lat >= 39.4 && lat <= 40.8 && lon <= -8.6) return 'high';

  // Porto & Norte coast: Matosinhos, Leça, Ofir, Âncora, Moledo
  if (lat >= 41.0 && lat <= 42.0 && lon <= -8.65) return 'high';

  // Everything else (inland, east-facing) — no correction
  return 'none';
}

export type { IpcjExposure };
