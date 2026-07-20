import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  getAuthSecret,
  parseOptionalBoolean,
  parseTrustedProxyHops,
  resetAuthConfigForTests,
  shouldUseSecureCookie
} from "@/lib/auth/config";
import {
  maximumPasswordBytes,
  passwordIsWithinBounds,
  validatedUsername
} from "@/lib/auth/input";
import {
  clearLoginFailures,
  clientIpFromHeaders,
  loginRateLimitBucketCountForTests,
  loginRetryAfterSeconds,
  recordLoginFailure,
  reserveLoginAttempt,
  resetLoginRateLimitsForTests
} from "@/lib/auth/login-rate-limit";
import {
  decodeSessionToken,
  encodeSessionToken
} from "@/lib/auth/session-token";
import {
  hashPassword,
  PasswordWorkLimitError,
  resetPasswordWorkForTests,
  verifyPassword
} from "@/lib/auth/password";
import {
  consumeSetupToken,
  ensureSetupToken,
  resetSetupTokenLogForTests,
  setupTokenMatches
} from "@/lib/auth/setup-token";
import {
  readFormDataWithLimit,
  RequestBodyTooLargeError
} from "@/lib/http/limited-form-data";
import { validateMediaFile } from "@/lib/media/file-validation";
import { trackedTempDir } from "./fixtures/tracked-temp-dir";

test("media validation trusts file signatures and rejects SVG", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(validateMediaFile(png), {
    extension: ".png",
    kind: "image",
    mime: "image/png"
  });
  assert.equal(validateMediaFile(Buffer.from("<svg><script /></svg>")), null);
  assert.equal(validateMediaFile(Buffer.from("not really a jpeg")), null);
  assert.equal(validateMediaFile(Buffer.from("%PDF-1.7"))?.mime, "application/pdf");
});

test("login throttling limits IP and account attempts", () => {
  resetLoginRateLimitsForTests();
  const now = Date.parse("2026-07-10T00:00:00.000Z");
  for (let index = 0; index < 5; index += 1) {
    recordLoginFailure("admin", "192.0.2.10", now + index);
  }
  assert.equal(loginRetryAfterSeconds("admin", "192.0.2.10", now + 10), 120);
  assert.equal(loginRetryAfterSeconds("admin", "198.51.100.1", now + 10), 0);
  assert.equal(
    loginRetryAfterSeconds("someone-else", "192.0.2.10", now + 10),
    0
  );

  for (let index = 0; index < 5; index += 1) {
    recordLoginFailure(`other-${index}`, "192.0.2.10", now + 20 + index);
  }
  assert.equal(
    loginRetryAfterSeconds("someone-else", "192.0.2.10", now + 30),
    900
  );
  clearLoginFailures("admin", "192.0.2.10");
  assert.equal(loginRetryAfterSeconds("admin", "192.0.2.10", now + 31), 0);
});

test("unknown sources use a conservative global limit without a six-request login DoS", () => {
  resetLoginRateLimitsForTests();
  const now = Date.parse("2026-07-10T00:00:00.000Z");
  for (let index = 0; index < 6; index += 1) {
    recordLoginFailure(`attacker-${index}`, "unknown", now + index);
  }
  assert.equal(loginRetryAfterSeconds("admin", "unknown", now + 10), 0);

  resetLoginRateLimitsForTests();
  for (let index = 0; index < 31; index += 1) {
    recordLoginFailure(`attacker-${index}`, "unknown", now + index);
  }
  assert.equal(loginRetryAfterSeconds("admin", "unknown", now + 100), 0);
  recordLoginFailure("attacker-31", "unknown", now + 101);
  assert.equal(loginRetryAfterSeconds("admin", "unknown", now + 102), 120);
});

test("login attempts are reserved before password verification can yield", () => {
  resetLoginRateLimitsForTests();
  const now = Date.parse("2026-07-10T00:00:00.000Z");

  // Simulate many requests reaching the admission point before any async
  // password verification has completed. Only the configured source threshold
  // may enter expensive work.
  const admitted = Array.from({ length: 50 }, (_, index) =>
    reserveLoginAttempt("admin", "192.0.2.10", now + index)
  ).filter((retryAfter) => retryAfter === 0);
  assert.equal(admitted.length, 5);
  assert.equal(
    loginRetryAfterSeconds("admin", "192.0.2.10", now + 100),
    120
  );

  resetLoginRateLimitsForTests();
  const sourceAdmitted = Array.from({ length: 50 }, (_, index) =>
    reserveLoginAttempt(`attacker-${index}`, "192.0.2.10", now + index)
  ).filter((retryAfter) => retryAfter === 0);
  assert.equal(sourceAdmitted.length, 10);

  resetLoginRateLimitsForTests();
  const accountAdmitted = Array.from({ length: 50 }, (_, index) =>
    reserveLoginAttempt(
      "admin",
      `198.51.100.${(index % 200) + 1}`,
      now + index
    )
  ).filter((retryAfter) => retryAfter === 0);
  assert.equal(accountAdmitted.length, 8);

  resetLoginRateLimitsForTests();
  const unknownAdmitted = Array.from({ length: 80 }, (_, index) =>
    reserveLoginAttempt(`attacker-${index}`, "unknown", now + index)
  ).filter((retryAfter) => retryAfter === 0);
  assert.equal(unknownAdmitted.length, 32);
});

test("blocked login requests do not extend the fixed block window", () => {
  resetLoginRateLimitsForTests();
  const now = Date.parse("2026-07-10T00:00:00.000Z");
  for (let index = 0; index < 5; index += 1) {
    recordLoginFailure("admin", "192.0.2.10", now);
  }
  assert.equal(loginRetryAfterSeconds("admin", "192.0.2.10", now), 120);
  recordLoginFailure("admin", "192.0.2.10", now + 60_000);
  assert.equal(
    loginRetryAfterSeconds("admin", "192.0.2.10", now + 121_000),
    0
  );
});

test("login throttling storage stays bounded under high-cardinality input", () => {
  resetLoginRateLimitsForTests();
  const now = Date.parse("2026-07-10T00:00:00.000Z");
  for (let index = 0; index < 3000; index += 1) {
    recordLoginFailure(`user-${index}`, `198.51.${index % 255}.${index % 253}`, now + index);
  }
  assert.ok(loginRateLimitBucketCountForTests() <= 1024);
});

test("client IP ignores forwarding by default and reads trusted hops from the right", () => {
  const headers = new Headers({
    "x-forwarded-for": "203.0.113.8, 198.51.100.9",
    "x-real-ip": "10.0.0.3"
  });
  assert.equal(clientIpFromHeaders(headers, 0), "unknown");
  assert.equal(clientIpFromHeaders(headers, 1), "198.51.100.9");
  assert.equal(
    clientIpFromHeaders(
      new Headers({
        "x-forwarded-for": "spoofed, 198.51.100.9, 10.0.0.2"
      }),
      2
    ),
    "198.51.100.9"
  );
  assert.equal(
    clientIpFromHeaders(new Headers({ "x-real-ip": "203.0.113.44" }), 1),
    "203.0.113.44"
  );
  assert.equal(
    clientIpFromHeaders(
      new Headers({ "x-forwarded-for": "203.0.113.8" }),
      2
    ),
    "unknown"
  );
});

test("security configuration rejects malformed explicit values but permits omissions", () => {
  assert.equal(parseOptionalBoolean("TEST_BOOLEAN", undefined), null);
  assert.equal(parseOptionalBoolean("TEST_BOOLEAN", ""), null);
  assert.equal(parseOptionalBoolean("TEST_BOOLEAN", "true"), true);
  assert.equal(parseOptionalBoolean("TEST_BOOLEAN", "OFF"), false);
  assert.throws(() => parseOptionalBoolean("TEST_BOOLEAN", "treu"));
  assert.equal(parseTrustedProxyHops(undefined), 0);
  assert.equal(parseTrustedProxyHops("2"), 2);
  assert.throws(() => parseTrustedProxyHops("-1"));
  assert.throws(() => parseTrustedProxyHops("9"));

  const previousSecure = process.env.SESSION_COOKIE_SECURE;
  const previousSiteUrl = process.env.SITE_URL;
  try {
    process.env.SESSION_COOKIE_SECURE = "";
    process.env.SITE_URL = "https://blog.example.com";
    assert.equal(shouldUseSecureCookie(), true);
    process.env.SESSION_COOKIE_SECURE = "false";
    assert.equal(shouldUseSecureCookie(), false);
    process.env.SESSION_COOKIE_SECURE = "treu";
    assert.throws(() => shouldUseSecureCookie());
  } finally {
    if (previousSecure === undefined) delete process.env.SESSION_COOKIE_SECURE;
    else process.env.SESSION_COOKIE_SECURE = previousSecure;
    if (previousSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previousSiteUrl;
  }
});

test("weak explicit auth secrets migrate to a strong persistent secret", () => {
  const root = trackedTempDir("manjyun-auth-secret-");
  const previousDataDir = process.env.DATA_DIR;
  const previousSecret = process.env.AUTH_SECRET;
  try {
    process.env.DATA_DIR = root;
    process.env.AUTH_SECRET = "";
    resetAuthConfigForTests();
    const generated = getAuthSecret();
    assert.ok(Buffer.byteLength(generated, "utf8") >= 32);
    assert.equal(fs.readFileSync(path.join(root, "auth-secret"), "utf8").trim(), generated);

    process.env.AUTH_SECRET = "legacy-short-secret";
    resetAuthConfigForTests();
    assert.equal(getAuthSecret(), generated);

    process.env.AUTH_SECRET = "s".repeat(32);
    resetAuthConfigForTests();
    assert.equal(getAuthSecret(), "s".repeat(32));
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
    resetAuthConfigForTests();
  }
});

test("generated setup token is persistent, constant-time checked, and consumed", () => {
  const root = trackedTempDir("manjyun-setup-token-");
  const previousDataDir = process.env.DATA_DIR;
  const previousToken = process.env.SETUP_TOKEN;
  const previousWarn = console.warn;
  const warnings: string[] = [];
  try {
    process.env.DATA_DIR = root;
    delete process.env.SETUP_TOKEN;
    console.warn = (message?: unknown) => warnings.push(String(message));
    resetSetupTokenLogForTests();
    const token = ensureSetupToken();
    assert.ok(Buffer.byteLength(token, "utf8") >= 24);
    assert.equal(ensureSetupToken(), token);
    assert.equal(warnings.length, 1);
    assert.equal(setupTokenMatches(token), true);
    assert.equal(setupTokenMatches(`${token}x`), false);
    consumeSetupToken();
    assert.equal(fs.existsSync(path.join(root, "setup-token")), false);

    process.env.SETUP_TOKEN = "e".repeat(24);
    assert.equal(ensureSetupToken(), "e".repeat(24));
    assert.equal(setupTokenMatches("e".repeat(24)), true);
    assert.equal(warnings.length, 1);
    consumeSetupToken();
    assert.equal(
      fs.existsSync(
        path.join(
          root,
          `.setup-token-consumed-${crypto
            .createHash("sha256")
            .update("e".repeat(24))
            .digest("hex")}`
        )
      ),
      true
    );
    assert.throws(() => ensureSetupToken(), /already been consumed/);

    process.env.SETUP_TOKEN = "f".repeat(24);
    assert.equal(ensureSetupToken(), "f".repeat(24));

    process.env.SETUP_TOKEN = "too-short";
    assert.throws(() => ensureSetupToken());
    process.env.SETUP_TOKEN = "x".repeat(513);
    assert.throws(() => ensureSetupToken(), /between 24 and 512 bytes/);
  } finally {
    console.warn = previousWarn;
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousToken === undefined) delete process.env.SETUP_TOKEN;
    else process.env.SETUP_TOKEN = previousToken;
    resetSetupTokenLogForTests();
  }
});

test("an invalid persistent auth secret fails closed", () => {
  const root = trackedTempDir("manjyun-invalid-secret-");
  fs.writeFileSync(path.join(root, "auth-secret"), "short");
  const previousDataDir = process.env.DATA_DIR;
  const previousSecret = process.env.AUTH_SECRET;
  try {
    process.env.DATA_DIR = root;
    delete process.env.AUTH_SECRET;
    resetAuthConfigForTests();
    assert.throws(() => getAuthSecret(), /at least 32 bytes/);
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
    resetAuthConfigForTests();
  }
});

test("session tokens are versioned while legacy version-one cookies remain valid", () => {
  const secret = "z".repeat(32);
  const now = 1_800_000_000;
  const token = encodeSessionToken(
    { adminId: 7, expiresAt: now + 60, sessionVersion: 3 },
    secret
  );
  assert.deepEqual(decodeSessionToken(token, secret, now), {
    adminId: 7,
    expiresAt: now + 60,
    sessionVersion: 3
  });
  assert.equal(decodeSessionToken(token, "wrong".repeat(8), now), null);
  assert.equal(decodeSessionToken(token, secret, now + 61), null);

  const legacyPayload = Buffer.from(
    JSON.stringify({ sub: 7, exp: now + 60 })
  ).toString("base64url");
  const legacySignature = crypto
    .createHmac("sha256", secret)
    .update(legacyPayload)
    .digest("base64url");
  assert.deepEqual(
    decodeSessionToken(`${legacyPayload}.${legacySignature}`, secret, now),
    { adminId: 7, expiresAt: now + 60, sessionVersion: 1 }
  );
});

test("authentication inputs have explicit resource bounds", () => {
  assert.equal(validatedUsername(" admin "), "admin");
  assert.equal(validatedUsername("x".repeat(129)), null);
  assert.equal(validatedUsername("admin\u0000other"), null);
  assert.equal(passwordIsWithinBounds("12345678"), true);
  assert.equal(passwordIsWithinBounds("密码密码密码"), false);
  assert.equal(passwordIsWithinBounds("😀😀"), false);
  assert.equal(passwordIsWithinBounds("密码密码密码密码"), true);
  assert.equal(passwordIsWithinBounds("x".repeat(maximumPasswordBytes + 1)), false);
});

test("password verification fails closed for malformed stored hashes", async () => {
  const password = "correct-password";
  const hash = await hashPassword(password);
  const [, salt, encoded] = hash.split("$");

  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);

  for (const malformed of [
    "",
    "scrypt$salt$!",
    `scrypt$${salt}$!`,
    `scrypt$${salt}$_`,
    `scrypt$${salt}$A`,
    `scrypt$${salt}$${encoded}=`,
    `scrypt$${salt}=$${encoded}`,
    `scrypt$${salt}$${"!".repeat(encoded.length)}`,
    `${hash}$extra`,
    `other$${salt}$${encoded}`,
    "x".repeat(513)
  ]) {
    assert.equal(
      await verifyPassword("arbitrary-password", malformed),
      false,
      `malformed stored hash must fail closed: ${malformed.slice(0, 40)}`
    );
  }
});

test("password work has a hard in-process concurrency bound", async () => {
  resetPasswordWorkForTests();
  const hash = await hashPassword("bounded-password");
  const attempts = await Promise.allSettled(
    Array.from({ length: 12 }, () =>
      verifyPassword("bounded-password", hash)
    )
  );
  assert.ok(
    attempts.filter(
      (attempt) =>
        attempt.status === "rejected" &&
        attempt.reason instanceof PasswordWorkLimitError
    ).length >= 1
  );
  assert.ok(
    attempts.filter(
      (attempt) => attempt.status === "fulfilled" && attempt.value
    ).length <= 4
  );
  resetPasswordWorkForTests();
});

test("multipart parsing enforces a streamed request limit", async () => {
  const input = new FormData();
  input.append("file", new File(["safe"], "safe.txt"));
  const request = new Request("http://localhost/upload", { method: "POST", body: input });
  const parsed = await readFormDataWithLimit(request, 1024);
  assert.equal((parsed.get("file") as File).name, "safe.txt");

  const oversized = new FormData();
  oversized.append("file", new File(["x".repeat(2048)], "large.txt"));
  const oversizedRequest = new Request("http://localhost/upload", {
    method: "POST",
    body: oversized
  });
  await assert.rejects(
    () => readFormDataWithLimit(oversizedRequest, 1024),
    RequestBodyTooLargeError
  );
});
