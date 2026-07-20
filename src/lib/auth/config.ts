import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createExclusiveSecretFile } from "@/lib/auth/secret-file";
import { getDataDir } from "@/lib/paths";

const minimumSecretBytes = 32;

type GlobalAuthConfig = typeof globalThis & {
  __manjyunAuthSecretCache?: { key: string; secret: string };
  __manjyunWeakSecretWarningShown?: boolean;
};

function normalizedOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function parseOptionalBoolean(
  name: string,
  value: string | undefined
): boolean | null {
  const normalized = normalizedOptional(value)?.toLowerCase() ?? null;
  if (normalized === null) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(
    `${name} must be one of true/false, 1/0, yes/no, or on/off.`
  );
}

export function parseTrustedProxyHops(value: string | undefined) {
  const normalized = normalizedOptional(value);
  if (normalized === null) return 0;
  if (!/^\d+$/.test(normalized)) {
    throw new Error("AUTH_TRUST_PROXY_HOPS must be an integer from 0 to 8.");
  }
  const hops = Number(normalized);
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > 8) {
    throw new Error("AUTH_TRUST_PROXY_HOPS must be an integer from 0 to 8.");
  }
  return hops;
}

export function shouldUseSecureCookie() {
  const configured = parseOptionalBoolean(
    "SESSION_COOKIE_SECURE",
    process.env.SESSION_COOKIE_SECURE
  );
  if (configured !== null) return configured;

  const siteUrl = normalizedOptional(process.env.SITE_URL);
  if (siteUrl) {
    let parsed: URL;
    try {
      parsed = new URL(siteUrl);
    } catch {
      throw new Error(
        "SITE_URL must be an absolute http:// or https:// URL when it is configured."
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        "SITE_URL must be an absolute http:// or https:// URL when it is configured."
      );
    }
    return parsed.protocol === "https:";
  }

  return process.env.NODE_ENV === "production";
}

function secretIsStrongEnough(secret: string) {
  return Buffer.byteLength(secret, "utf8") >= minimumSecretBytes;
}

function readSecretFile(secretPath: string) {
  const stat = fs.lstatSync(secretPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Authentication secret path is not a regular file: ${secretPath}`);
  }
  const secret = fs.readFileSync(secretPath, "utf8").trim();
  if (!secretIsStrongEnough(secret)) {
    throw new Error(
      `Authentication secret file must contain at least ${minimumSecretBytes} bytes: ${secretPath}`
    );
  }
  try {
    fs.chmodSync(secretPath, 0o600);
  } catch {
    // Some NAS bind mounts do not support chmod. File readability is still
    // governed by the mounted directory and container user in that case.
  }
  return secret;
}

function persistentSecret(secretPath: string) {
  createExclusiveSecretFile(
    secretPath,
    crypto.randomBytes(32).toString("base64url")
  );
  return readSecretFile(secretPath);
}

export function getAuthSecret() {
  const envSecret = normalizedOptional(process.env.AUTH_SECRET);
  const dataDir = getDataDir();
  const cacheKey = `${dataDir}\0${envSecret ?? ""}`;
  const state = globalThis as GlobalAuthConfig;
  if (state.__manjyunAuthSecretCache?.key === cacheKey) {
    return state.__manjyunAuthSecretCache.secret;
  }

  let secret: string;
  if (envSecret && secretIsStrongEnough(envSecret)) {
    secret = envSecret;
  } else {
    const secretPath = path.join(dataDir, "auth-secret");
    secret = persistentSecret(secretPath);
    if (envSecret && !state.__manjyunWeakSecretWarningShown) {
      console.warn(
        `[ManJyun] AUTH_SECRET is shorter than ${minimumSecretBytes} bytes and was not used. ` +
          `A strong persistent secret at ${secretPath} is active instead; existing sessions may need to sign in again.`
      );
      state.__manjyunWeakSecretWarningShown = true;
    }
  }

  state.__manjyunAuthSecretCache = { key: cacheKey, secret };
  return secret;
}

export function validateAuthConfiguration() {
  getAuthSecret();
  shouldUseSecureCookie();
  parseTrustedProxyHops(process.env.AUTH_TRUST_PROXY_HOPS);
}

export function resetAuthConfigForTests() {
  const state = globalThis as GlobalAuthConfig;
  delete state.__manjyunAuthSecretCache;
  delete state.__manjyunWeakSecretWarningShown;
}
