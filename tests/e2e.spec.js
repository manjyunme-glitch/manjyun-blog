import { test, expect } from "@playwright/test";

const baseUrl = process.env.E2E_BASE_URL;
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const shouldRun = Boolean(baseUrl && username && password);

async function expectNoPageOverflow(page) {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.skip(!shouldRun, "Set E2E_BASE_URL, E2E_USERNAME, and E2E_PASSWORD to run.");

test("setup admin and publish a post", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`${baseUrl}/admin/setup`);
  if (page.url().includes("/admin/setup") && await page.locator('input[name="username"]').isVisible().catch(() => false)) {
    await page.locator('input[name="username"]').fill(username || "");
    await page.locator('input[name="password"]').fill(password || "");
    await page.locator('input[name="passwordConfirm"]').fill(password || "");
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
    page.getByRole("heading", { level: 1, name: "E2E Test Post" })
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

  await page.goto(`${baseUrl}/`);
  const originalTheme = await page.locator("[data-theme]").first().getAttribute("data-theme");
  expect(originalTheme).toBeTruthy();

  await page.goto(`${baseUrl}/admin/themes`);
  await expect(page.locator(".theme-card")).toHaveCount(3);
  await expect(page.locator(".theme-pair-previews")).toHaveCount(3);

  for (const targetTheme of ["manjyun-console", "paper-atlas", "neon-rift"]) {
    await page.goto(`${baseUrl}/admin/themes`);
    const targetCard = page.locator(`[data-theme-id="${targetTheme}"]`);
    const activate = targetCard.getByRole("button", { name: "激活" });
    if (await activate.isVisible().catch(() => false)) await activate.click();
    await expect(page.locator(`[data-admin-root][data-admin-theme="${targetTheme}"]`)).toBeVisible();
    await expect(targetCard.locator(".status-pill")).toHaveText("当前");
    await page.goto(`${baseUrl}/`);
    await expect(page.locator(`[data-theme="${targetTheme}"]`)).toBeVisible();
  }

  await page.goto(`${baseUrl}/admin/themes`);
  const originalCard = page.locator(`[data-theme-id="${originalTheme}"]`);
  const restoreOriginal = originalCard.getByRole("button", { name: "激活" });
  if (await restoreOriginal.isVisible().catch(() => false)) await restoreOriginal.click();
  await expect(page.locator(`[data-admin-root][data-admin-theme="${originalTheme}"]`)).toBeVisible();

  const missingPreview = await page.goto(`${baseUrl}/theme-preview/%25`);
  expect(missingPreview?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "页面不存在" })).toBeVisible();

  await page.evaluate(() => fetch("/api/admin/logout", { method: "POST" }));
  await page.goto(`${baseUrl}/admin/login`);
  await page.locator('input[name="username"]').fill(username || "");
  await page.locator('input[name="password"]').fill(password || "");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/admin", { timeout: 15000 });

  await page.goto(`${baseUrl}/admin/posts/${result.body.id}`);
  await page.getByRole("button", { name: "写作", exact: true }).click();
  const editor = page.locator(".markdown-editor");
  await editor.fill("## Local recovery\n\nUnsaved browser draft.");
  await page.waitForTimeout(800);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByText(/检测到.*本地草稿/)).toBeVisible();
  await page.getByRole("button", { name: "恢复草稿" }).click();
  await expect(editor).toHaveValue(/Unsaved browser draft/);
  await page.getByRole("button", { name: "保存更改" }).click();
  await expect(page.getByText("已保存更改", { exact: true })).toBeVisible();

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    for (const path of ["/admin", "/admin/posts", `/admin/posts/${result.body.id}`]) {
      await page.goto(`${baseUrl}${path}`);
      await expectNoPageOverflow(page);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/admin`);
  const navToggle = page.locator(".admin-nav-toggle");
  await expect(navToggle).toHaveAccessibleName("打开后台导航");
  await navToggle.click();
  await expect(navToggle).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("link", { name: "内容", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/posts/);
  await expect(page.locator(".content-table tbody tr").first()).toBeVisible();
});
