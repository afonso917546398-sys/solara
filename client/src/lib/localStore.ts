// Local persistence layer — replaces the old Express/Postgres backend.
// All data lives in the browser's localStorage under "solara:" keys.

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
  localStorage.setItem(FAVOURITES_KEY, JSON.stringify(favs));
}

export function getFavourites(): Favourite[] {
  return readFavourites();
}

export function addFavourite(data: { name: string; lat: number; lon: number }): Favourite {
  const favs = readFavourites();
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
  return localStorage.getItem(PREF_PREFIX + key);
}

export function setPref(key: string, value: string) {
  localStorage.setItem(PREF_PREFIX + key, value);
}
