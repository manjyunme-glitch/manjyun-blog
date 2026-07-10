import { test, expect } from "@playwright/test";

const baseUrl = process.env.E2E_BASE_URL;
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const shouldRun = Boolean(baseUrl && username && password);

test.skip(!shouldRun, "Set E2E_BASE_URL, E2E_USERNAME, and E2E_PASSWORD to run.");

test("setup admin and publish a post", async ({ page }) => {
  await page.goto(`${baseUrl}/admin/setup`);
  if (await page.locator('input[name="username"]').isVisible().catch(() => false)) {
    await page.locator('input[name="username"]').fill(username || "");
    await page.locator('input[name="password"]').fill(password || "");
    await page.locator('button[type="submit"]').click();
  }
  if (page.url().includes("/admin/login")) {
    await page.locator('input[name="username"]').fill(username || "");
    await page.locator('input[name="password"]').fill(password || "");
    await page.locator('button[type="submit"]').click();
  }
  await page.waitForURL("**/admin", { timeout: 15000 });

  const result = await page.evaluate(async () => {
    const response = await fetch("/api/admin/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "post",
        status: "published",
        title: "E2E Test Post",
        slug: "e2e-test-post",
        markdown: "# E2E Test Post\n\nThis verifies publishing.",
        excerpt: "Verification post.",
        tags: "test"
      })
    });
    return { ok: response.ok, body: await response.json() };
  });
  expect(result.ok, JSON.stringify(result.body)).toBeTruthy();
  expect(result.body.ok).toBeTruthy();

  await page.goto(`${baseUrl}/posts/${result.body.slug}`);
  await expect(
    page.locator(".gh-content h1", { hasText: "E2E Test Post" })
  ).toBeVisible();

  const rejectedUpload = await page.evaluate(async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new File(["<svg><script>alert(1)</script></svg>"], "spoofed.png", {
        type: "image/png"
      })
    );
    const response = await fetch("/api/admin/media", {
      method: "POST",
      body: formData
    });
    return { body: await response.json(), status: response.status };
  });
  expect(rejectedUpload.status).toBe(415);
  expect(rejectedUpload.body.ok).toBeFalsy();

  const acceptedUpload = await page.evaluate(async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        "spoofed.svg",
        { type: "image/svg+xml" }
      )
    );
    const response = await fetch("/api/admin/media", {
      method: "POST",
      body: formData
    });
    return { body: await response.json(), status: response.status };
  });
  expect(acceptedUpload.status).toBe(200);
  expect(acceptedUpload.body.media.mime).toBe("image/png");
  expect(acceptedUpload.body.media.url).toMatch(/\.png$/);

  await page.evaluate(() => fetch("/api/admin/logout", { method: "POST" }));
  await page.goto(`${baseUrl}/admin/login`);
  await page.locator('input[name="username"]').fill(username || "");
  await page.locator('input[name="password"]').fill(password || "");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/admin", { timeout: 15000 });
});
