import fs from "node:fs";
import path from "node:path";

export function getDataDir() {
  const configured = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  return path.resolve(/* turbopackIgnore: true */ configured);
}

export function getDatabasePath() {
  const configured = process.env.DATABASE_PATH ?? path.join(getDataDir(), "manjyun.sqlite");
  return path.resolve(/* turbopackIgnore: true */ configured);
}

export function getUploadsDir() {
  const configured = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
  return path.resolve(/* turbopackIgnore: true */ configured);
}

export function ensureDataDir() {
  fs.mkdirSync(/*turbopackIgnore: true*/ getDataDir(), { recursive: true });
}

export function ensureUploadsDir() {
  fs.mkdirSync(/*turbopackIgnore: true*/ getUploadsDir(), { recursive: true });
}

export function ensureRuntimeDirs() {
  ensureDataDir();
  ensureUploadsDir();
}

export function assertInside(baseDir: string, candidate: string) {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(candidate);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error("Path escapes configured directory.");
  }
  return resolved;
}
