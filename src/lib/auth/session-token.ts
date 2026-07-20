import crypto from "node:crypto";

export type SessionClaims = {
  adminId: number;
  expiresAt: number;
  sessionVersion: number;
};

function signatureFor(payload: string, secret: string) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

function signaturesMatch(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function encodeSessionToken(
  claims: SessionClaims,
  secret: string
) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: claims.adminId,
      exp: claims.expiresAt,
      ver: claims.sessionVersion
    })
  ).toString("base64url");
  return `${payload}.${signatureFor(payload, secret)}`;
}

export function decodeSessionToken(
  token: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): SessionClaims | null {
  if (!token || token.length > 2048) return null;
  const pieces = token.split(".");
  if (pieces.length !== 2) return null;
  const [payload, signature] = pieces;
  if (
    !payload ||
    !signature ||
    !signaturesMatch(signature, signatureFor(payload, secret))
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { sub?: unknown; exp?: unknown; ver?: unknown };
    if (
      !Number.isSafeInteger(parsed.sub) ||
      Number(parsed.sub) <= 0 ||
      !Number.isSafeInteger(parsed.exp) ||
      Number(parsed.exp) < nowSeconds
    ) {
      return null;
    }

    // Cookies issued before session-version support are version 1. This keeps
    // upgrades seamless until logout, password change, or an offline reset
    // increments the database version.
    const sessionVersion = parsed.ver === undefined ? 1 : Number(parsed.ver);
    if (!Number.isSafeInteger(sessionVersion) || sessionVersion < 1) return null;

    return {
      adminId: Number(parsed.sub),
      expiresAt: Number(parsed.exp),
      sessionVersion
    };
  } catch {
    return null;
  }
}
