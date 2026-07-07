import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { ensureDataDir, getDatabasePath } from "@/lib/paths";
import { ensureSchema } from "@/lib/db/schema";

type GlobalDb = typeof globalThis & {
  __manjyunDb?: DatabaseSync;
  __manjyunSchemaReady?: boolean;
};

function openDatabase() {
  ensureDataDir();
  const db = new DatabaseSync(/*turbopackIgnore: true*/ getDatabasePath());
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

export function getDb() {
  const globalDb = globalThis as GlobalDb;
  if (!globalDb.__manjyunDb) {
    globalDb.__manjyunDb = openDatabase();
  }

  if (!globalDb.__manjyunSchemaReady) {
    ensureSchema(globalDb.__manjyunDb);
    globalDb.__manjyunSchemaReady = true;
  }

  return globalDb.__manjyunDb;
}

export function all<T>(sql: string, params: unknown[] = []) {
  return getDb()
    .prepare(sql)
    .all(...(params as SQLInputValue[]))
    .map(toPlainRow) as T[];
}

export function get<T>(sql: string, params: unknown[] = []) {
  const row = getDb().prepare(sql).get(...(params as SQLInputValue[]));
  return row ? (toPlainRow(row) as T) : null;
}

export function run(sql: string, params: unknown[] = []) {
  return getDb().prepare(sql).run(...(params as SQLInputValue[]));
}

export function exec(sql: string) {
  getDb().exec(sql);
}

function toPlainRow(row: unknown) {
  if (!row || typeof row !== "object") return row;
  return Object.fromEntries(Object.entries(row));
}
