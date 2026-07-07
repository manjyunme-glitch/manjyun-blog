import fs from "node:fs";
import path from "node:path";

export function getDataDir() {
  return path.resolve(
    process.env.DATA_DIR ??
      path.join(/*turbopackIgnore: true*/ process.cwd(), "data")
  );
}

export function getDatabasePath() {
  return path.resolve(
    process.env.DATABASE_PATH ?? path.join(getDataDir(), "manjyun.sqlite")
  );
}

export function getUploadsDir() {
  return path.resolve(
    process.env.UPLOADS_DIR ??
      path.join(/*turbopackIgnore: true*/ process.cwd(), "uploads")
  );
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
