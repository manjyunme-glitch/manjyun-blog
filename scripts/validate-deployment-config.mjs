import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fail(message) {
  for (const line of String(message).split("\n")) {
    console.error(`[ManJyun preflight] ${line}`);
  }
  process.exit(1);
}

function warn(message) {
  console.warn(`[ManJyun preflight] WARNING: ${message}`);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required and cannot be blank.`);
  return value;
}

function isHostAbsolutePath(value) {
  if (value === "/" || /^[A-Za-z]:[\\/]?$/.test(value)) return false;
  return (
    /^\/.+/.test(value) ||
    /^[A-Za-z]:[\\/].+/.test(value) ||
    /^\\\\[^\\/]+[\\/][^\\/]+/.test(value)
  );
}

function isInside(baseDir, candidate) {
  const relative = path.relative(path.resolve(baseDir), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function validateBoolean(name) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return;
  if (!["1", "true", "yes", "on", "0", "false", "no", "off"].includes(value)) {
    fail(`${name} must be true/false, 1/0, yes/no, or on/off.`);
  }
}

function runtimeIdentity() {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const gid = typeof process.getgid === "function" ? process.getgid() : undefined;
  return {
    uid,
    gid,
    label:
      uid === undefined || gid === undefined
        ? `platform ${process.platform}`
        : `container process UID:GID ${uid}:${gid}`
  };
}

function describeStat(stat) {
  if (!stat) return "target metadata unavailable";
  const mode = (stat.mode & 0o7777).toString(8).padStart(4, "0");
  const owner =
    typeof stat.uid === "number" && typeof stat.gid === "number"
      ? `owner UID:GID ${stat.uid}:${stat.gid}`
      : "owner unavailable";
  return `${owner}, mode ${mode}`;
}

function joinHostPath(baseDir, leaf) {
  const separator = baseDir.includes("\\") ? "\\" : "/";
  return `${baseDir.replace(/[\\/]+$/, "")}${separator}${leaf}`;
}

function permissionFailure(
  name,
  target,
  error,
  stat,
  hostBaseDir,
  hostLeaf,
  requiredAccess = "writable"
) {
  const identity = runtimeIdentity();
  const reason =
    error instanceof Error
      ? `${"code" in error && error.code ? `${error.code}: ` : ""}${error.message}`
      : String(error);
  const hostTarget = joinHostPath(hostBaseDir, hostLeaf);
  const lines = [
    `${name} is not ${requiredAccess} at ${target} (${identity.label}; ${describeStat(stat)}; ${reason}).`,
    `The container never changes bind-mount ownership automatically. Check that ${hostTarget} is mounted read-write and grants ${identity.uid ?? "the runtime UID"}:${identity.gid ?? "the runtime GID"} access.`
  ];
  if (identity.uid === 0) {
    lines.push(
      "This stack is using legacy root compatibility mode, so also check the NAS ACL and whether the bind mount or filesystem is read-only."
    );
  } else {
    lines.push(
      `For a new empty deployment, create data/ and uploads/ first and chown only those two top-level directories to ${identity.uid}:${identity.gid} (do not use recursive chown).`
    );
    lines.push(
      "For an existing deployment, keep its explicit BLOG_UID=0 and BLOG_GID=0 until ownership of the database, WAL/SHM files, auth files, and uploads has been inspected during a planned offline migration."
    );
  }
  fail(lines.join("\n"));
}

function assertWritableDirectory(name, directory, hostBaseDir, hostLeaf) {
  let stat;
  try {
    stat = fs.statSync(directory);
  } catch (error) {
    permissionFailure(name, directory, error, undefined, hostBaseDir, hostLeaf);
  }
  if (!stat.isDirectory()) fail(`${name} must point to a directory: ${directory}`);

  const probe = path.join(
    directory,
    `.manjyun-write-probe-${process.pid}-${crypto.randomBytes(8).toString("hex")}`
  );
  let descriptor;
  let writeError;
  try {
    descriptor = fs.openSync(probe, "wx", 0o600);
    fs.writeSync(descriptor, "probe\n");
    fs.fsyncSync(descriptor);
  } catch (error) {
    writeError = error;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch (error) {
        writeError ??= error;
      }
      try {
        fs.unlinkSync(probe);
      } catch (error) {
        writeError ??= error;
      }
    }
  }
  if (writeError) {
    permissionFailure(name, directory, writeError, stat, hostBaseDir, hostLeaf);
  }
}

function assertWritableFileIfPresent(name, filename, hostBaseDir, hostLeaf) {
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    permissionFailure(name, filename, error, undefined, hostBaseDir, hostLeaf);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${name} must point to a regular, non-symbolic-link file when it exists: ${filename}`);
  }

  let descriptor;
  try {
    descriptor = fs.openSync(filename, "r+");
  } catch (error) {
    permissionFailure(name, filename, error, stat, hostBaseDir, hostLeaf);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertSecretFileIfPresent(
  name,
  filename,
  hostBaseDir,
  hostLeaf,
  minimumBytes,
  maximumBytes
) {
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    permissionFailure(name, filename, error, undefined, hostBaseDir, hostLeaf, "readable");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${name} must point to a regular, non-symbolic-link file when it exists: ${filename}`);
  }

  let descriptor;
  let contents;
  try {
    descriptor = fs.openSync(filename, "r");
    contents = fs.readFileSync(descriptor, "utf8");
  } catch (error) {
    permissionFailure(name, filename, error, stat, hostBaseDir, hostLeaf, "readable");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  const bytes = Buffer.byteLength(contents.trim(), "utf8");
  if (bytes < minimumBytes || (maximumBytes !== undefined && bytes > maximumBytes)) {
    fail(
      maximumBytes === undefined
        ? `${name} must contain at least ${minimumBytes} UTF-8 bytes after trimming: ${filename}`
        : `${name} must contain between ${minimumBytes} and ${maximumBytes} UTF-8 bytes after trimming: ${filename}`
    );
  }
}

const hostBaseDir = required("STACK_BASE_DIR_HOST");
if (!isHostAbsolutePath(hostBaseDir)) {
  fail(
    "STACK_BASE_DIR must be an absolute, non-root host path (for example /share/DockerData/manjyun-blog)."
  );
}

const siteUrlValue = required("SITE_URL");
let siteUrl;
try {
  siteUrl = new URL(siteUrlValue);
} catch {
  fail("SITE_URL must be an absolute http:// or https:// URL.");
}
if (
  !["http:", "https:"].includes(siteUrl.protocol) ||
  !siteUrl.hostname ||
  siteUrl.username ||
  siteUrl.password
) {
  fail("SITE_URL must be an absolute http:// or https:// URL without embedded credentials.");
}

const dataDirValue = required("DATA_DIR");
const databasePathValue = required("DATABASE_PATH");
const uploadsDirValue = required("UPLOADS_DIR");
if (
  !path.isAbsolute(dataDirValue) ||
  !path.isAbsolute(databasePathValue) ||
  !path.isAbsolute(uploadsDirValue)
) {
  fail("DATA_DIR, DATABASE_PATH, and UPLOADS_DIR must be absolute container paths.");
}
const dataDir = path.resolve(dataDirValue);
const databasePath = path.resolve(databasePathValue);
const uploadsDir = path.resolve(uploadsDirValue);
if (!isInside(dataDir, databasePath) || databasePath === dataDir) {
  fail("DATABASE_PATH must name a file inside DATA_DIR.");
}
if (dataDir === uploadsDir || isInside(dataDir, uploadsDir) || isInside(uploadsDir, dataDir)) {
  fail("DATA_DIR and UPLOADS_DIR must be separate, non-nested directories.");
}

const trustedProxyHops = process.env.AUTH_TRUST_PROXY_HOPS?.trim() || "0";
if (!/^\d+$/.test(trustedProxyHops) || Number(trustedProxyHops) > 8) {
  fail("AUTH_TRUST_PROXY_HOPS must be an integer from 0 to 8.");
}
validateBoolean("SESSION_COOKIE_SECURE");

const setupToken = process.env.SETUP_TOKEN?.trim();
if (setupToken) {
  const bytes = Buffer.byteLength(setupToken, "utf8");
  if (bytes < 24 || bytes > 512) {
    fail("SETUP_TOKEN must contain between 24 and 512 UTF-8 bytes when configured.");
  }
}

assertWritableDirectory("DATA_DIR", dataDir, hostBaseDir, "data");
assertWritableDirectory("UPLOADS_DIR", uploadsDir, hostBaseDir, "uploads");
assertWritableFileIfPresent(
  "DATABASE_PATH",
  databasePath,
  hostBaseDir,
  `data/${path.basename(databasePath)}`
);
assertWritableFileIfPresent(
  "SQLite WAL file",
  `${databasePath}-wal`,
  hostBaseDir,
  `data/${path.basename(databasePath)}-wal`
);
assertWritableFileIfPresent(
  "SQLite shared-memory file",
  `${databasePath}-shm`,
  hostBaseDir,
  `data/${path.basename(databasePath)}-shm`
);
const configuredAuthSecret = process.env.AUTH_SECRET?.trim();
if (!configuredAuthSecret || Buffer.byteLength(configuredAuthSecret, "utf8") < 32) {
  assertSecretFileIfPresent(
    "Persistent authentication secret",
    path.join(dataDir, "auth-secret"),
    hostBaseDir,
    "data/auth-secret",
    32
  );
}
if (!setupToken) {
  assertSecretFileIfPresent(
    "Generated setup token",
    path.join(dataDir, "setup-token"),
    hostBaseDir,
    "data/setup-token",
    24,
    512
  );
}

const identity = runtimeIdentity();
if (identity.uid === 0) {
  warn(
    "running as root because BLOG_UID/BLOG_GID explicitly selected legacy compatibility mode; existing deployments may keep this setting until a planned offline permission migration."
  );
}
console.log(
  `[ManJyun preflight] Deployment configuration and persistent directories are valid (${identity.label}).`
);
