import crypto from "node:crypto";
import net from "node:net";
import { parseTrustedProxyHops } from "@/lib/auth/config";

type LoginBucket = {
  attempts: number[];
  blockedUntil: number;
  lastSeen: number;
};

type LoginRateLimitState = {
  buckets: Map<string, LoginBucket>;
  lastPrunedAt: number;
};

type GlobalRateLimits = typeof globalThis & {
  __manjyunLoginRateLimit?: LoginRateLimitState;
};

const windowMs = 15 * 60 * 1000;
const sourceBlockMs = 15 * 60 * 1000;
const pairBlockMs = 2 * 60 * 1000;
const accountBlockMs = 2 * 60 * 1000;
const globalBlockMs = 2 * 60 * 1000;
const maxSourceAttempts = 10;
const maxPairAttempts = 5;
const maxAccountAttempts = 8;
const maxGlobalAttempts = 32;
const maxBuckets = 1024;
const pruneIntervalMs = 30 * 1000;
const maximumForwardedHeaderLength = 2048;
const maximumForwardedHops = 32;
const maximumUsernameKeyLength = 256;

function state() {
  const globalState = globalThis as GlobalRateLimits;
  globalState.__manjyunLoginRateLimit ??= {
    buckets: new Map(),
    lastPrunedAt: 0
  };
  return globalState.__manjyunLoginRateLimit;
}

function normalizedUsernameHash(username: string) {
  // Bound attacker-controlled work before normalization. The tail is
  // irrelevant to rate-limit identity because valid usernames are much
  // shorter than this prefix.
  const normalized = username
    .slice(0, maximumUsernameKeyLength * 2)
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .slice(0, maximumUsernameKeyLength);
  return crypto
    .createHash("sha256")
    .update(normalized || "<empty>")
    .digest("base64url");
}

function sourceKey(ip: string) {
  return ip === "unknown" ? "source:unknown" : `source:${ip}`;
}

function pairKey(username: string, ip: string) {
  return `pair:${ip}:${normalizedUsernameHash(username)}`;
}

function accountKey(username: string) {
  return `account:${normalizedUsernameHash(username)}`;
}

function rulesFor(username: string, ip: string) {
  const rules = [
    {
      blockMs: globalBlockMs,
      key: "global",
      maxAttempts: maxGlobalAttempts
    },
    {
      blockMs: accountBlockMs,
      key: accountKey(username),
      maxAttempts: maxAccountAttempts
    }
  ];
  if (ip !== "unknown") {
    rules.push(
      {
        blockMs: sourceBlockMs,
        key: sourceKey(ip),
        maxAttempts: maxSourceAttempts
      },
      {
        blockMs: pairBlockMs,
        key: pairKey(username, ip),
        maxAttempts: maxPairAttempts
      }
    );
  }
  return rules;
}

function prune(now: number, force = false) {
  const current = state();
  if (
    !force &&
    current.buckets.size < maxBuckets &&
    now - current.lastPrunedAt < pruneIntervalMs
  ) {
    return;
  }
  for (const [key, bucket] of current.buckets) {
    bucket.attempts = bucket.attempts.filter(
      (attempt) => now - attempt < windowMs
    );
    if (
      key !== "global" &&
      bucket.blockedUntil <= now &&
      bucket.attempts.length === 0
    ) {
      current.buckets.delete(key);
    }
  }
  current.lastPrunedAt = now;
}

function makeRoomFor(key: string, now: number) {
  const current = state();
  if (current.buckets.has(key)) return;
  prune(now, current.buckets.size >= maxBuckets);
  while (current.buckets.size >= maxBuckets) {
    let oldestKey: string | null = null;
    let oldestSeen = Number.POSITIVE_INFINITY;
    for (const [candidate, bucket] of current.buckets) {
      if (candidate === "global") continue;
      if (bucket.lastSeen < oldestSeen) {
        oldestSeen = bucket.lastSeen;
        oldestKey = candidate;
      }
    }
    if (!oldestKey) return;
    current.buckets.delete(oldestKey);
  }
}

export function loginRetryAfterSeconds(
  username: string,
  ip: string,
  now = Date.now()
) {
  prune(now);
  let blockedUntil = 0;
  for (const rule of rulesFor(username, ip)) {
    const bucket = state().buckets.get(rule.key);
    if (bucket) {
      bucket.lastSeen = now;
      blockedUntil = Math.max(blockedUntil, bucket.blockedUntil);
    }
  }
  return blockedUntil > now ? Math.ceil((blockedUntil - now) / 1000) : 0;
}

/**
 * Atomically admits and accounts for an authentication attempt before the
 * caller starts the expensive password hash. JavaScript runs this function
 * without an await boundary, so concurrent requests cannot all observe an
 * empty bucket and then enqueue unbounded scrypt work.
 *
 * The attempt that reaches a threshold is allowed to finish. Subsequent
 * attempts receive the fixed retry window, which is never extended while
 * blocked.
 */
export function reserveLoginAttempt(
  username: string,
  ip: string,
  now = Date.now()
) {
  const retryAfter = loginRetryAfterSeconds(username, ip, now);
  if (retryAfter > 0) return retryAfter;
  recordLoginFailure(username, ip, now);
  return 0;
}

export function recordLoginFailure(
  username: string,
  ip: string,
  now = Date.now()
) {
  prune(now);
  for (const rule of rulesFor(username, ip)) {
    makeRoomFor(rule.key, now);
    const bucket = state().buckets.get(rule.key) ?? {
      attempts: [],
      blockedUntil: 0,
      lastSeen: now
    };
    bucket.lastSeen = now;

    // Requests made during a block never extend it. This prevents an attacker
    // from holding a source in a permanent lock merely by continuing to send.
    if (bucket.blockedUntil <= now) {
      bucket.attempts = bucket.attempts.filter(
        (attempt) => now - attempt < windowMs
      );
      bucket.attempts.push(now);
      if (bucket.attempts.length >= rule.maxAttempts) {
        bucket.attempts = [];
        bucket.blockedUntil = now + rule.blockMs;
      }
    }
    state().buckets.set(rule.key, bucket);
  }
}

export function clearLoginFailures(username: string, ip: string) {
  state().buckets.delete(accountKey(username));
  state().buckets.delete(pairKey(username, ip));
  if (ip !== "unknown") state().buckets.delete(sourceKey(ip));
}

function normalizeIp(value: string | undefined) {
  let candidate = value?.trim();
  if (!candidate || candidate.length > 128 || candidate.includes('"')) return null;

  const bracketed = candidate.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) candidate = bracketed[1];
  if (net.isIP(candidate) === 0) {
    const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (!ipv4WithPort || net.isIP(ipv4WithPort[1]) !== 4) return null;
    candidate = ipv4WithPort[1];
  }
  if (candidate.toLowerCase().startsWith("::ffff:")) {
    const mapped = candidate.slice(7);
    if (net.isIP(mapped) === 4) return mapped;
  }
  return candidate.toLowerCase();
}

export function clientIpFromHeaders(
  headers: Pick<Headers, "get">,
  trustedProxyHops = parseTrustedProxyHops(
    process.env.AUTH_TRUST_PROXY_HOPS
  )
) {
  if (trustedProxyHops === 0) return "unknown";

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded && forwarded.length <= maximumForwardedHeaderLength) {
    const values = forwarded.split(",").map((value) => value.trim());
    if (values.length <= maximumForwardedHops) {
      // Trusted proxies append the address they received from. Reading from
      // the right edge means attacker-supplied leftmost XFF values are ignored.
      const candidateIndex = values.length - trustedProxyHops;
      if (candidateIndex >= 0) {
        return normalizeIp(values[candidateIndex]) ?? "unknown";
      }
    }
  }

  if (trustedProxyHops === 1) {
    return normalizeIp(headers.get("x-real-ip") ?? undefined) ?? "unknown";
  }
  return "unknown";
}

export function loginRateLimitBucketCountForTests() {
  return state().buckets.size;
}

export function resetLoginRateLimitsForTests() {
  delete (globalThis as GlobalRateLimits).__manjyunLoginRateLimit;
}
