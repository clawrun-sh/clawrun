import type { StateStore } from "./state-types";
import { PostgresStateStore } from "./state-postgres";

export function getStateStore(): StateStore | null {
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) return null;
  return new PostgresStateStore();
}

export type { StateStore } from "./state-types";
