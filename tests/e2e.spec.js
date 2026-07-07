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
    return { ok: response.ok, body: await response.text() };
  });
  expect(result.ok, result.body).toBeTruthy();

  await page.goto(`${baseUrl}/posts/e2e-test-post`);
  await expect(page.locator(".article-title", { hasText: "E2E Test Post" })).toBeVisible();
});
