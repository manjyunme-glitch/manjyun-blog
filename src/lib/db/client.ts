import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { ensureDataDir, getDatabasePath } from "@/lib/paths";
import { ensureSchema } from "@/lib/db/schema";

type GlobalDb = typeof globalThis & {
  __manjyunDb?: DatabaseSync;
  __manjyunSchemaReady?: boolean;
  __manjyunTransactionDepth?: number;
  __manjyunSavepointId?: number;
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

export function transaction<T>(operation: () => T): T {
  const db = getDb();
  const globalDb = globalThis as GlobalDb;
  const depth = globalDb.__manjyunTransactionDepth ?? 0;
  const savepointId = (globalDb.__manjyunSavepointId ?? 0) + 1;
  const savepoint = `manjyun_sp_${savepointId}`;

  globalDb.__manjyunSavepointId = savepointId;
  if (depth === 0) {
    db.exec("BEGIN IMMEDIATE");
  } else {
    db.exec(`SAVEPOINT ${savepoint}`);
  }
  globalDb.__manjyunTransactionDepth = depth + 1;

  try {
    const result = operation();
    if (depth === 0) {
      db.exec("COMMIT");
    } else {
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    }
    return result;
  } catch (error) {
    if (depth === 0) {
      db.exec("ROLLBACK");
    } else {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    }
    throw error;
  } finally {
    globalDb.__manjyunTransactionDepth = depth;
  }
}

function toPlainRow(row: unknown) {
  if (!row || typeof row !== "object") return row;
  return Object.fromEntries(Object.entries(row));
}
