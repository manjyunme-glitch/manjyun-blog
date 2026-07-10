type LoginBucket = {
  attempts: number[];
  blockedUntil: number;
};

type GlobalRateLimits = typeof globalThis & {
  __manjyunLoginBuckets?: Map<string, LoginBucket>;
};

const windowMs = 15 * 60 * 1000;
const accountBlockMs = 5 * 60 * 1000;
const ipBlockMs = 15 * 60 * 1000;
const maxAccountAttempts = 10;
const maxIpAttempts = 5;

function buckets() {
  const state = globalThis as GlobalRateLimits;
  state.__manjyunLoginBuckets ??= new Map();
  return state.__manjyunLoginBuckets;
}

function accountKey(username: string) {
  return `account:${username.trim().normalize("NFKC").toLowerCase() || "<empty>"}`;
}

function ipKey(ip: string) {
  return ip && ip !== "unknown" ? `ip:${ip}` : null;
}

function keysFor(username: string, ip: string) {
  return [accountKey(username), ipKey(ip)].filter((key): key is string => Boolean(key));
}

function prune(now: number) {
  const store = buckets();
  for (const [key, bucket] of store) {
    bucket.attempts = bucket.attempts.filter((attempt) => now - attempt < windowMs);
    if (bucket.blockedUntil <= now && bucket.attempts.length === 0) {
      store.delete(key);
    }
  }
}

export function loginRetryAfterSeconds(username: string, ip: string, now = Date.now()) {
  prune(now);
  let blockedUntil = 0;
  for (const key of keysFor(username, ip)) {
    blockedUntil = Math.max(blockedUntil, buckets().get(key)?.blockedUntil ?? 0);
  }
  return blockedUntil > now ? Math.ceil((blockedUntil - now) / 1000) : 0;
}

export function recordLoginFailure(username: string, ip: string, now = Date.now()) {
  prune(now);
  const rules = [
    { blockMs: accountBlockMs, key: accountKey(username), maxAttempts: maxAccountAttempts },
    { blockMs: ipBlockMs, key: ipKey(ip), maxAttempts: maxIpAttempts }
  ];

  for (const rule of rules) {
    if (!rule.key) continue;
    const bucket = buckets().get(rule.key) ?? { attempts: [], blockedUntil: 0 };
    if (bucket.blockedUntil > now) continue;
    bucket.attempts.push(now);
    if (bucket.attempts.length >= rule.maxAttempts) {
      bucket.attempts = [];
      bucket.blockedUntil = now + rule.blockMs;
    }
    buckets().set(rule.key, bucket);
  }
}

export function clearLoginFailures(username: string, ip: string) {
  for (const key of keysFor(username, ip)) {
    buckets().delete(key);
  }
}

export function clientIpFromHeaders(headers: Pick<Headers, "get">) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

export function resetLoginRateLimitsForTests() {
  buckets().clear();
}
