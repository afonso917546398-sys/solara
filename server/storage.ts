import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, desc } from "drizzle-orm";
import {
  favourites, verificationLog, preferences,
  type InsertFavourite, type Favourite,
  type InsertLog, type VerificationEntry,
} from "../shared/schema";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, { ssl: "require", max: 10 });
export const db = drizzle(client);

// Run migrations (create tables if not exist)
export async function initDb() {
  await client`
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;
  await client`
    CREATE TABLE IF NOT EXISTS favourites (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      added_at BIGINT NOT NULL
    )
  `;
  await client`
    CREATE TABLE IF NOT EXISTS verification_log (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      location_name TEXT NOT NULL,
      forecast_score INTEGER NOT NULL,
      peak_start TEXT,
      peak_end TEXT,
      went_out INTEGER NOT NULL,
      sun_accuracy INTEGER,
      felt_worth_it INTEGER,
      logged_at BIGINT NOT NULL
    )
  `;
}

export interface IStorage {
  getPref(key: string): Promise<string | null>;
  setPref(key: string, value: string): Promise<void>;
  getFavourites(): Promise<Favourite[]>;
  addFavourite(f: InsertFavourite): Promise<Favourite>;
  removeFavourite(id: number): Promise<void>;
  getLogs(): Promise<VerificationEntry[]>;
  addLog(entry: InsertLog): Promise<VerificationEntry>;
  getLogByDate(date: string): Promise<VerificationEntry | undefined>;
}

export class Storage implements IStorage {
  async getPref(key: string): Promise<string | null> {
    const rows = await db.select().from(preferences).where(eq(preferences.key, key));
    return rows[0]?.value ?? null;
  }

  async setPref(key: string, value: string): Promise<void> {
    await client`
      INSERT INTO preferences (key, value) VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
  }

  async getFavourites(): Promise<Favourite[]> {
    return db.select().from(favourites).orderBy(desc(favourites.addedAt));
  }

  async addFavourite(f: InsertFavourite): Promise<Favourite> {
    const rows = await db.insert(favourites).values(f).returning();
    return rows[0];
  }

  async removeFavourite(id: number): Promise<void> {
    await db.delete(favourites).where(eq(favourites.id, id));
  }

  async getLogs(): Promise<VerificationEntry[]> {
    return db.select().from(verificationLog).orderBy(desc(verificationLog.loggedAt));
  }

  async addLog(entry: InsertLog): Promise<VerificationEntry> {
    const rows = await db.insert(verificationLog).values(entry).returning();
    return rows[0];
  }

  async getLogByDate(date: string): Promise<VerificationEntry | undefined> {
    const rows = await db.select().from(verificationLog).where(eq(verificationLog.date, date));
    return rows[0];
  }
}

export const storage = new Storage();
