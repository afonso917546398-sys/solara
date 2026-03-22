import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { insertFavouriteSchema, insertLogSchema } from "../shared/schema";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ── Preferences
  app.get("/api/prefs/:key", async (req, res) => {
    res.json({ value: await storage.getPref(req.params.key) });
  });

  app.post("/api/prefs/:key", async (req, res) => {
    await storage.setPref(req.params.key, req.body.value);
    res.json({ ok: true });
  });

  // ── Favourites
  app.get("/api/favourites", async (_req, res) => {
    res.json(await storage.getFavourites());
  });

  app.post("/api/favourites", async (req, res) => {
    const parsed = insertFavouriteSchema.safeParse({
      ...req.body,
      addedAt: Date.now(),
    });
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    res.json(await storage.addFavourite(parsed.data));
  });

  app.delete("/api/favourites/:id", async (req, res) => {
    await storage.removeFavourite(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Verification log
  app.get("/api/log", async (_req, res) => {
    res.json(await storage.getLogs());
  });

  app.get("/api/log/:date", async (req, res) => {
    const entry = await storage.getLogByDate(req.params.date);
    res.json(entry ?? null);
  });

  app.post("/api/log", async (req, res) => {
    const parsed = insertLogSchema.safeParse({
      ...req.body,
      loggedAt: Date.now(),
    });
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    res.json(await storage.addLog(parsed.data));
  });

  return httpServer;
}
