import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { assertInside, getUploadsDir } from "@/lib/paths";

export type StorageFailureKind =
  | "not-found"
  | "permission"
  | "no-space"
  | "io"
  | "conflict"
  | "invalid-path"
  | "unknown";

export class MediaStorageError extends Error {
  constructor(
    message: string,
    readonly kind: StorageFailureKind,
    options: { cause?: unknown } = {}
  ) {
    super(message, options);
    this.name = "MediaStorageError";
  }
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
}

function hardLinkUnavailable(error: unknown) {
  return ["EPERM", "ENOSYS", "EOPNOTSUPP", "ENOTSUP", "EXDEV"].includes(
    errorCode(error)
  );
}

export function storageFailureKind(error: unknown): StorageFailureKind {
  if (error instanceof MediaStorageError) return error.kind;
  const code = errorCode(error);
  if (code === "ENOENT") return "not-found";
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return "permission";
  }
  if (code === "ENOSPC" || code === "EDQUOT") return "no-space";
  if (code === "EIO") return "io";
  return "unknown";
}

export function resolveMediaPath(relativeFilename: string) {
  const normalized = relativeFilename.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new MediaStorageError("Invalid media filename.", "invalid-path");
  }
  const uploadsDir = getUploadsDir();
  try {
    return assertInside(
      uploadsDir,
      path.join(uploadsDir, ...normalized.split("/"))
    );
  } catch (error) {
    throw new MediaStorageError("Invalid media filename.", "invalid-path", {
      cause: error
    });
  }
}

function digest(bytes: Uint8Array) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function digestFile(target: string) {
  const handle = await fs.open(target, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new MediaStorageError(
        "The media target exists but is not a regular file.",
        "conflict"
      );
    }
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        position
      );
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash.digest("hex");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function existingFileMatchesHash(
  target: string,
  expectedHash: string
) {
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new MediaStorageError(
        "The media target exists but is not a regular file.",
        "conflict"
      );
    }
    return (await digestFile(target)) === expectedHash;
  } catch (error) {
    if (storageFailureKind(error) === "not-found") return false;
    throw error;
  }
}

async function publishWithRenameLock(
  temporary: string,
  target: string,
  expectedHash: string
): Promise<"created" | "existing"> {
  const lockPath = `${target}.publish-lock`;
  let lockHandle: fs.FileHandle | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lockHandle = await fs.open(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (
        await existingFileMatchesHash(target, expectedHash).catch(
          () => false
        )
      ) {
        return "existing";
      }
      const stale = await fs
        .stat(lockPath)
        .then((stat) => Date.now() - stat.mtimeMs > 10 * 60 * 1000)
        .catch(() => false);
      if (attempt === 0 && stale) {
        await fs.unlink(lockPath).catch(() => undefined);
        continue;
      }
      throw new MediaStorageError(
        "Another process is publishing this media file; retry the same operation.",
        "conflict",
        { cause: error }
      );
    }
  }
  if (!lockHandle) {
    throw new MediaStorageError(
      "Unable to acquire the media publish lock.",
      "conflict"
    );
  }

  try {
    const targetExists = await fs
      .lstat(target)
      .then(() => true)
      .catch((error) => {
        if (storageFailureKind(error) === "not-found") return false;
        throw error;
    });
    if (targetExists) {
      if (await existingFileMatchesHash(target, expectedHash)) {
        return "existing";
      }
      throw new MediaStorageError(
        "The media target already exists with different content.",
        "conflict"
      );
    }
    // All application instances honor the exclusive sibling lock, making
    // rename safe on NAS filesystems that cannot create hard links.
    await fs.rename(temporary, target);
    return "created";
  } finally {
    await lockHandle.close().catch(() => undefined);
    await fs.unlink(lockPath).catch(() => undefined);
  }
}

/**
 * Publishes a closed hidden staging file with an exclusive hard link. Unlike
 * rename(), link() never replaces a target created by another process between
 * our preflight check and publish. The rename-lock fallback supports NAS
 * filesystems that cannot create hard links.
 */
export async function publishStagedMediaFileAtomically(
  relativeFilename: string,
  temporaryPath: string,
  expectedHash: string
): Promise<"created" | "existing"> {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new MediaStorageError(
      "The staged media hash is invalid.",
      "conflict"
    );
  }
  const target = resolveMediaPath(relativeFilename);
  const directory = path.dirname(target);
  const uploadsDir = getUploadsDir();
  let temporary: string;

  try {
    temporary = assertInside(uploadsDir, temporaryPath);
    if (
      path.dirname(temporary) !== uploadsDir ||
      !/^\..+\.upload-[a-f0-9-]+\.tmp$/i.test(path.basename(temporary))
    ) {
      throw new MediaStorageError(
        "The media staging path is invalid.",
        "invalid-path"
      );
    }
    const stagedStat = await fs.lstat(temporary);
    if (!stagedStat.isFile() || stagedStat.isSymbolicLink()) {
      throw new MediaStorageError(
        "The media staging path is not a regular file.",
        "invalid-path"
      );
    }
    await fs.mkdir(directory, { recursive: true });
    if (await existingFileMatchesHash(target, expectedHash)) {
      await fs.unlink(temporary);
      return "existing";
    }
  } catch (error) {
    if (error instanceof MediaStorageError) throw error;
    throw new MediaStorageError(
      "Unable to prepare the staged media file.",
      storageFailureKind(error),
      { cause: error }
    );
  }

  try {
    try {
      await fs.link(temporary, target);
      // Publishing succeeded even if a storage appliance briefly refuses to
      // remove the hidden staging name. The read-only reconciliation report
      // surfaces that bounded residue for later cleanup.
      await fs.unlink(temporary).catch(() => undefined);
      return "created";
    } catch (error) {
      if (hardLinkUnavailable(error)) {
        const result = await publishWithRenameLock(
          temporary,
          target,
          expectedHash
        );
        if (result === "existing") {
          await fs.unlink(temporary).catch(() => undefined);
        }
        return result;
      }
      throw error;
    }
  } catch (error) {
    const targetExists = await fs
      .lstat(target)
      .then(() => true)
      .catch((issue) => {
        if (storageFailureKind(issue) === "not-found") return false;
        throw issue;
      });
    if (targetExists) {
      if (await existingFileMatchesHash(target, expectedHash)) {
        await fs.unlink(temporary).catch(() => undefined);
        return "existing";
      }
      throw new MediaStorageError(
        "The media target already exists with different content.",
        "conflict",
        { cause: error }
      );
    }
    if (
      error instanceof MediaStorageError ||
      storageFailureKind(error) === "conflict"
    ) {
      throw error;
    }
    throw new MediaStorageError(
      "Unable to write the media file.",
      storageFailureKind(error),
      { cause: error }
    );
  }
}

/**
 * Buffer convenience wrapper for small internally-created assets. User media
 * uploads use publishStagedMediaFileAtomically directly, so the request body
 * is never materialized as a full in-memory Buffer.
 */
export async function writeMediaFileAtomically(
  relativeFilename: string,
  bytes: Uint8Array
): Promise<"created" | "existing"> {
  const uploadsDir = getUploadsDir();
  const temporary = path.join(
    uploadsDir,
    `.media.upload-${crypto.randomUUID()}.tmp`
  );
  let handle: fs.FileHandle | null = null;
  try {
    await fs.mkdir(uploadsDir, { recursive: true });
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    return await publishStagedMediaFileAtomically(
      relativeFilename,
      temporary,
      digest(bytes)
    );
  } catch (error) {
    if (error instanceof MediaStorageError) throw error;
    throw new MediaStorageError(
      "Unable to write the media file.",
      storageFailureKind(error),
      { cause: error }
    );
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.unlink(temporary).catch(() => undefined);
  }
}

export type StagedMediaDeletion =
  | { state: "missing"; originalPath: string }
  | {
      state: "staged";
      originalPath: string;
      stagedPath: string;
    };

/**
 * Rename first so the public URL disappears atomically. The caller can then
 * commit the database delete and unlink the staged file, or rename it back if
 * the database transaction fails.
 */
export async function stageMediaDeletion(
  relativeFilename: string
): Promise<StagedMediaDeletion> {
  const originalPath = resolveMediaPath(relativeFilename);
  try {
    const stat = await fs.lstat(originalPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new MediaStorageError(
        "The media path is not a regular file.",
        "conflict"
      );
    }
  } catch (error) {
    if (storageFailureKind(error) === "not-found") {
      return { state: "missing", originalPath };
    }
    if (error instanceof MediaStorageError) throw error;
    throw new MediaStorageError(
      "Unable to inspect the media file.",
      storageFailureKind(error),
      { cause: error }
    );
  }

  const stagedPath = path.join(
    path.dirname(originalPath),
    `.${path.basename(originalPath)}.trash-${crypto.randomUUID()}`
  );
  try {
    await fs.rename(originalPath, stagedPath);
    return { state: "staged", originalPath, stagedPath };
  } catch (error) {
    if (storageFailureKind(error) === "not-found") {
      return { state: "missing", originalPath };
    }
    throw new MediaStorageError(
      "Unable to stage the media file for deletion.",
      storageFailureKind(error),
      { cause: error }
    );
  }
}

export async function rollbackStagedMediaDeletion(
  staged: StagedMediaDeletion
) {
  if (staged.state !== "staged") return;
  try {
    await fs.rename(staged.stagedPath, staged.originalPath);
  } catch (error) {
    throw new MediaStorageError(
      "Unable to restore the media file after a database failure.",
      storageFailureKind(error),
      { cause: error }
    );
  }
}

export async function commitStagedMediaDeletion(
  staged: StagedMediaDeletion
) {
  if (staged.state !== "staged") return true;
  try {
    await fs.unlink(staged.stagedPath);
    return true;
  } catch (error) {
    if (storageFailureKind(error) === "not-found") return true;
    return false;
  }
}

export async function discardFailedUpload(relativeFilename: string) {
  const target = resolveMediaPath(relativeFilename);
  try {
    await fs.unlink(target);
    return true;
  } catch (error) {
    return storageFailureKind(error) === "not-found";
  }
}
