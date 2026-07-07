import crypto from "node:crypto";

const keyLength = 64;

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, hash: string) {
  const [scheme, salt, encoded] = hash.split("$");
  if (scheme !== "scrypt" || !salt || !encoded) return false;
  const actual = Buffer.from(encoded, "base64url");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, actual.length, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
  return (
    actual.length === derived.length && crypto.timingSafeEqual(actual, derived)
  );
}
