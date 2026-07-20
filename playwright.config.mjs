import { defineConfig } from "@playwright/test";

const baseURL = process.env.MANJYUN_E2E_BASE_URL;

if (!baseURL) {
  throw new Error(
    "The Playwright suite must be started with `npm run test:e2e`."
  );
}

const parsedBaseURL = new URL(baseURL);
const loopbackHosts = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
if (
  parsedBaseURL.protocol !== "http:" ||
  !loopbackHosts.has(parsedBaseURL.hostname)
) {
  throw new Error(
    `Refusing to configure Playwright for non-loopback URL ${parsedBaseURL.origin}.`
  );
}

export default defineConfig({
  testDir: "./tests",
  testMatch: "e2e.spec.js",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: parsedBaseURL.origin,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  }
});
