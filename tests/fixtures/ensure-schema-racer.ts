import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ensureSchema } from "@/lib/db/schema";

const barrier = process.env.SCHEMA_TEST_BARRIER;
const racerId = process.env.SCHEMA_TEST_RACER_ID;
const databasePath = process.env.DATABASE_PATH;
if (!barrier || !racerId || !databasePath) {
  throw new Error(
    "SCHEMA_TEST_BARRIER, SCHEMA_TEST_RACER_ID, and DATABASE_PATH are required."
  );
}

fs.writeFileSync(`${barrier}.${racerId}.ready`, "ready");
const deadline = Date.now() + 5000;
while (!fs.existsSync(barrier)) {
  if (Date.now() >= deadline) throw new Error("Timed out waiting for schema barrier.");
  await new Promise((resolve) => setTimeout(resolve, 10));
}

const database = new DatabaseSync(databasePath);
database.exec("PRAGMA busy_timeout = 5000;");
try {
  ensureSchema(database);
  process.stdout.write("migrated");
} finally {
  database.close();
}
