import { QueryClient, QueryFunction } from "@tanstack/react-query";
import * as store from "./localStore";

// Routes the old "/api/..." paths to localStorage so the app runs fully
// static — no backend required.
function handleLocal(method: string, url: string, data?: any): unknown {
  const prefMatch = url.match(/^\/api\/prefs\/(.+)$/);
  if (prefMatch) {
    if (method === "GET") return { value: store.getPref(prefMatch[1]) };
    store.setPref(prefMatch[1], String(data?.value ?? ""));
    return { ok: true };
  }

  const favIdMatch = url.match(/^\/api\/favourites\/(\d+)$/);
  if (favIdMatch && method === "DELETE") {
    store.removeFavourite(Number(favIdMatch[1]));
    return { ok: true };
  }

  if (url === "/api/favourites") {
    if (method === "GET") return store.getFavourites();
    return store.addFavourite(data);
  }

  throw new Error(`Unknown local route: ${method} ${url}`);
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const result = handleLocal(method, url, data);
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
}

const localQueryFn: QueryFunction = async ({ queryKey }) =>
  handleLocal("GET", queryKey.join("/"));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: localQueryFn,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
