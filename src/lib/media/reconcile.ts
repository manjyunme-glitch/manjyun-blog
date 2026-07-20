import fs from "node:fs/promises";
import path from "node:path";
import {
  MediaStorageError,
  resolveMediaPath,
  storageFailureKind
} from "@/lib/media/storage";
import { getUploadsDir } from "@/lib/paths";
import type { MediaRecord } from "@/types/blog";

const detailLimit = 200;

export type MediaReconciliationReport = {
  checkedAt: string;
  databaseRecords: number;
  managedFiles: number;
  missing: Array<Pick<MediaRecord, "id" | "filename" | "originalName" | "url">>;
  missingCount: number;
  orphaned: string[];
  orphanedCount: number;
  transient: string[];
  transientCount: number;
  detailsTruncated: boolean;
};

function normalizeRelative(filename: string) {
  return filename.replaceAll("\\", "/");
}

function isTransient(relative: string) {
  const basename = path.posix.basename(relative);
  return (
    (basename.startsWith(".") && basename.includes(".upload-") && basename.endsWith(".tmp")) ||
    (basename.startsWith(".") && basename.includes(".trash-")) ||
    basename.endsWith(".publish-lock")
  );
}

async function walkRegularFiles(root: string) {
  const files: string[] = [];

  async function walk(directory: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (storageFailureKind(error) === "not-found" && directory === root) return;
      throw new MediaStorageError(
        "Unable to enumerate the uploads directory.",
        storageFailureKind(error),
        { cause: error }
      );
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolute).split(path.sep).join("/"));
      }
    }
  }

  await walk(root);
  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * Read-only reconciliation: it never deletes files or records. Link-icon
 * cache files are intentionally excluded because they are managed by a
 * separate cache and have no media table row.
 */
export async function reconcileMediaStorage(
  records: MediaRecord[]
): Promise<MediaReconciliationReport> {
  const missing: MediaReconciliationReport["missing"] = [];
  for (const record of records) {
    try {
      const stat = await fs.lstat(resolveMediaPath(record.filename));
      if (!stat.isFile() || stat.isSymbolicLink()) {
        missing.push({
          id: record.id,
          filename: record.filename,
          originalName: record.originalName,
          url: record.url
        });
      }
    } catch (error) {
      if (
        storageFailureKind(error) === "not-found" ||
        storageFailureKind(error) === "invalid-path"
      ) {
        missing.push({
          id: record.id,
          filename: record.filename,
          originalName: record.originalName,
          url: record.url
        });
        continue;
      }
      throw new MediaStorageError(
        "Unable to inspect a media file.",
        storageFailureKind(error),
        { cause: error }
      );
    }
  }

  const actual = await walkRegularFiles(getUploadsDir());
  const known = new Set(records.map((record) => normalizeRelative(record.filename)));
  const transient = actual.filter(isTransient);
  const orphaned = actual.filter(
    (relative) =>
      !relative.startsWith("link-icons/") &&
      !isTransient(relative) &&
      !known.has(relative)
  );
  const managedFiles = actual.filter(
    (relative) => !relative.startsWith("link-icons/") && !isTransient(relative)
  ).length;
  const detailsTruncated =
    missing.length > detailLimit ||
    orphaned.length > detailLimit ||
    transient.length > detailLimit;

  return {
    checkedAt: new Date().toISOString(),
    databaseRecords: records.length,
    managedFiles,
    missing: missing.slice(0, detailLimit),
    missingCount: missing.length,
    orphaned: orphaned.slice(0, detailLimit),
    orphanedCount: orphaned.length,
    transient: transient.slice(0, detailLimit),
    transientCount: transient.length,
    detailsTruncated
  };
}
