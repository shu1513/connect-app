import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Check .env.local.");

// Reuse one connection pool across hot reloads while developing.
const globalForDb = globalThis as unknown as { __pg?: ReturnType<typeof postgres> };
const client = globalForDb.__pg ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.__pg = client;

export const db = drizzle(client, { schema });
export { schema };
