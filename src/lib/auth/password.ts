import crypto from "node:crypto";

const keyLength = 64;
const maximumConcurrentPasswordWork = 4;
const maximumStoredHashLength = 512;
const minimumSaltLength = 16;
const maximumSaltLength = 128;
const encodedKeyLength = Buffer.alloc(keyLength).toString("base64url").length;

type GlobalPasswordWork = typeof globalThis & {
  __manjyunActivePasswordWork?: number;
};

export class PasswordWorkLimitError extends Error {
  constructor() {
    super("Too many password operations are already in progress.");
    this.name = "PasswordWorkLimitError";
  }
}

function isCanonicalBase64Url(value: string) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    return Buffer.from(value, "base64url").toString("base64url") === value;
  } catch {
    return false;
  }
}

async function withPasswordWorkSlot<T>(operation: () => Promise<T>) {
  const state = globalThis as GlobalPasswordWork;
  const active = state.__manjyunActivePasswordWork ?? 0;
  if (active >= maximumConcurrentPasswordWork) {
    throw new PasswordWorkLimitError();
  }
  state.__manjyunActivePasswordWork = active + 1;
  try {
    return await operation();
  } finally {
    state.__manjyunActivePasswordWork = Math.max(
      0,
      (state.__manjyunActivePasswordWork ?? 1) - 1
    );
  }
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const derived = await withPasswordWorkSlot(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        crypto.scrypt(password, salt, keyLength, (error, key) => {
          if (error) reject(error);
          else resolve(key);
        });
      })
  );
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, hash: string) {
  if (!hash || hash.length > maximumStoredHashLength) return false;
  const pieces = hash.split("$");
  if (pieces.length !== 3) return false;
  const [scheme, salt, encoded] = pieces;
  if (
    scheme !== "scrypt" ||
    salt.length < minimumSaltLength ||
    salt.length > maximumSaltLength ||
    !isCanonicalBase64Url(salt) ||
    encoded.length !== encodedKeyLength ||
    !isCanonicalBase64Url(encoded)
  ) {
    return false;
  }

  let actual: Buffer;
  try {
    actual = Buffer.from(encoded, "base64url");
  } catch {
    return false;
  }
  if (
    actual.length !== keyLength ||
    actual.toString("base64url") !== encoded
  ) {
    return false;
  }

  const derived = await withPasswordWorkSlot(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        crypto.scrypt(password, salt, keyLength, (error, key) => {
          if (error) reject(error);
          else resolve(key);
        });
      })
  );
  return (
    actual.length === derived.length && crypto.timingSafeEqual(actual, derived)
  );
}

export function resetPasswordWorkForTests() {
  delete (globalThis as GlobalPasswordWork).__manjyunActivePasswordWork;
}
