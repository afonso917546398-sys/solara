// Local persistence layer — replaces the old Express/Postgres backend.
// All data lives in the browser's localStorage under "solara:" keys.
// Reads and writes are guarded: in Safari private mode and some embedded
// browsers localStorage throws, and the app should still work (just
// without persistence).

export interface Favourite {
  id: number;
  name: string;
  lat: number;
  lon: number;
  addedAt: number;
}

const FAVOURITES_KEY = "solara:favourites";
const PREF_PREFIX = "solara:pref:";

function readFavourites(): Favourite[] {
  try {
    const raw = localStorage.getItem(FAVOURITES_KEY);
    return raw ? (JSON.parse(raw) as Favourite[]) : [];
  } catch {
    return [];
  }
}

function writeFavourites(favs: Favourite[]) {
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(favs));
  } catch {
    // storage unavailable — favourite lives only for this session
  }
}

export function getFavourites(): Favourite[] {
  return readFavourites();
}

export function addFavourite(data: { name: string; lat: number; lon: number }): Favourite {
  const favs = readFavourites();
  const existing = favs.find(
    f => Math.abs(f.lat - data.lat) < 0.001 && Math.abs(f.lon - data.lon) < 0.001
  );
  if (existing) return existing;
  const fav: Favourite = {
    id: favs.length ? Math.max(...favs.map(f => f.id)) + 1 : 1,
    name: data.name,
    lat: data.lat,
    lon: data.lon,
    addedAt: Date.now(),
  };
  writeFavourites([...favs, fav]);
  return fav;
}

export function removeFavourite(id: number) {
  writeFavourites(readFavourites().filter(f => f.id !== id));
}

export function getPref(key: string): string | null {
  try {
    return localStorage.getItem(PREF_PREFIX + key);
  } catch {
    return null;
  }
}

export function setPref(key: string, value: string) {
  try {
    localStorage.setItem(PREF_PREFIX + key, value);
  } catch {
    // storage unavailable — preference lives only for this session
  }
}
