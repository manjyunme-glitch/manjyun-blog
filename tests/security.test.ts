import assert from "node:assert/strict";
import test from "node:test";
import {
  clearLoginFailures,
  clientIpFromHeaders,
  loginRetryAfterSeconds,
  recordLoginFailure,
  resetLoginRateLimitsForTests
} from "@/lib/auth/login-rate-limit";
import {
  readFormDataWithLimit,
  RequestBodyTooLargeError
} from "@/lib/http/limited-form-data";
import { validateMediaFile } from "@/lib/media/file-validation";

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
  for (let index = 0; index < 4; index += 1) {
    recordLoginFailure("admin", "192.0.2.10", now + index);
  }
  assert.equal(loginRetryAfterSeconds("admin", "192.0.2.10", now + 10), 0);
  recordLoginFailure("admin", "192.0.2.10", now + 11);
  assert.equal(loginRetryAfterSeconds("someone-else", "192.0.2.10", now + 12), 900);

  resetLoginRateLimitsForTests();
  for (let index = 0; index < 10; index += 1) {
    recordLoginFailure("admin", `192.0.2.${index + 20}`, now + index);
  }
  assert.equal(loginRetryAfterSeconds("ADMIN", "198.51.100.1", now + 20), 300);
  clearLoginFailures("admin", "198.51.100.1");
  assert.equal(loginRetryAfterSeconds("admin", "198.51.100.1", now + 21), 0);
});

test("client IP uses the first forwarding hop", () => {
  const headers = new Headers({
    "x-forwarded-for": "203.0.113.8, 10.0.0.2",
    "x-real-ip": "10.0.0.3"
  });
  assert.equal(clientIpFromHeaders(headers), "203.0.113.8");
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
