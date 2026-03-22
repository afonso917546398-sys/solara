import { pgTable, text, integer, real, serial, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Favourite locations ───────────────────────────────────────────
export const favourites = pgTable("favourites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  addedAt: bigint("added_at", { mode: "number" }).notNull(),
});

export const insertFavouriteSchema = createInsertSchema(favourites).omit({ id: true });
export type InsertFavourite = z.infer<typeof insertFavouriteSchema>;
export type Favourite = typeof favourites.$inferSelect;

// ── Verification log ─────────────────────────────────────────────
export const verificationLog = pgTable("verification_log", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  locationName: text("location_name").notNull(),
  forecastScore: integer("forecast_score").notNull(),
  peakStart: text("peak_start"),
  peakEnd: text("peak_end"),
  wentOut: integer("went_out").notNull(),
  sunAccuracy: integer("sun_accuracy"),
  feltWorthIt: integer("felt_worth_it"),
  loggedAt: bigint("logged_at", { mode: "number" }).notNull(),
});

export const insertLogSchema = createInsertSchema(verificationLog).omit({ id: true });
export type InsertLog = z.infer<typeof insertLogSchema>;
export type VerificationEntry = typeof verificationLog.$inferSelect;

// ── User preferences ─────────────────────────────────────────────
export const preferences = pgTable("preferences", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
export type Preference = typeof preferences.$inferSelect;
