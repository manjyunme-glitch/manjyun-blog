import { test, expect } from "@playwright/test";

const baseUrl = process.env.MANJYUN_E2E_BASE_URL;
const setupToken = process.env.MANJYUN_E2E_SETUP_TOKEN;
const username = process.env.MANJYUN_E2E_USERNAME;
const password = process.env.MANJYUN_E2E_PASSWORD;
const changedPassword = process.env.MANJYUN_E2E_CHANGED_PASSWORD;

function requireIsolatedRuntime() {
  if (!baseUrl || !setupToken || !username || !password || !changedPassword) {
    throw new Error(
      "Run this suite through `npm run test:e2e`; the isolated runner supplies all runtime values."
    );
  }

  const parsed = new URL(baseUrl);
  const loopbackHosts = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
  if (parsed.protocol !== "http:" || !loopbackHosts.has(parsed.hostname)) {
    throw new Error(
      `Refusing to run E2E tests against non-loopback URL ${parsed.origin}.`
    );
  }
}

requireIsolatedRuntime();

async function login(page, loginPassword = password) {
  await page.goto("/admin/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(loginPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/admin");
}

async function uploadPng(page, idempotencyKey) {
  return page.evaluate(
    async ({ key }) => {
      const formData = new FormData();
      formData.append(
        "file",
        new File(
          [
            new Uint8Array([
              0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
            ])
          ],
          "e2e-image.png",
          { type: "image/png" }
        )
      );
      const response = await fetch("/api/admin/media", {
        method: "POST",
        headers: key ? { "Idempotency-Key": key } : undefined,
        body: formData
      });
      return {
        body: await response.json(),
        replayed: response.headers.get("Idempotency-Replayed"),
        status: response.status
      };
    },
    { key: idempotencyKey }
  );
}

test.describe.configure({ mode: "serial" });

test("first-run setup token, API auth, removed logout API, and real logout", async ({
  page,
  request
}) => {
  test.setTimeout(60_000);

  const anonymousMedia = await request.get("/api/admin/media");
  expect(anonymousMedia.status()).toBe(401);
  await expect(anonymousMedia.json()).resolves.toMatchObject({
    ok: false,
    code: "UNAUTHORIZED"
  });

  await page.goto("/admin/setup");
  await page.getByLabel("初始化令牌").fill(`${setupToken}-wrong`);
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码").fill(password);
  await page.getByRole("button", { name: "创建管理员" }).click();
  await expect(
    page.locator(".admin-notice[role='alert']")
  ).toContainText("初始化令牌无效");
  await expect(page).toHaveURL(/\/admin\/setup/);

  await page.getByLabel("初始化令牌").fill(setupToken);
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码").fill(password);
  await page.getByRole("button", { name: "创建管理员" }).click();
  await page.waitForURL("**/admin");

  const removedLogout = await page.request.post("/api/admin/logout");
  expect(removedLogout.status()).toBe(404);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: /后台|概览/ })).toBeVisible();

  await page.getByRole("button", { name: "退出登录" }).click();
  await page.waitForURL("**/admin/login");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);

  await login(page);
  await page.goto("/admin/setup");
  await expect(page).toHaveURL(/\/admin$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  const navigation = page.locator("#admin-primary-navigation");
  const navigationToggle = page.locator(".admin-nav-toggle");
  await expect(navigation).toHaveAttribute("aria-hidden", "true");
  await expect
    .poll(() => navigation.evaluate((element) => element.inert))
    .toBe(true);

  await navigationToggle.click();
  await expect(navigationToggle).toHaveAttribute("aria-expanded", "true");
  await expect(navigation).not.toHaveAttribute("aria-hidden", "true");
  await expect
    .poll(() => navigation.evaluate((element) => element.inert))
    .toBe(false);
  await expect(navigation.locator(".admin-menu a[href='/admin']")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(navigationToggle).toHaveAttribute("aria-expanded", "false");
  await expect(navigationToggle).toBeFocused();
  await expect(navigation).toHaveAttribute("aria-hidden", "true");
  await expect
    .poll(() => navigation.evaluate((element) => element.inert))
    .toBe(true);
});

test("media and post APIs enforce idempotency and protect referenced files", async ({
  page
}) => {
  test.setTimeout(60_000);
  await login(page);

  const missingMediaKey = await uploadPng(page, "");
  expect(missingMediaKey.status).toBe(400);
  expect(missingMediaKey.body.code).toBe("INVALID_IDEMPOTENCY_KEY");

  const mediaKey = "e2e-media-upload-key-0001";
  const firstUpload = await uploadPng(page, mediaKey);
  expect(firstUpload.status, JSON.stringify(firstUpload.body)).toBe(200);
  expect(firstUpload.body).toMatchObject({
    ok: true,
    replayed: false,
    media: { mime: "image/png", originalName: "e2e-image.png" }
  });

  const replayedUpload = await uploadPng(page, mediaKey);
  expect(replayedUpload.status, JSON.stringify(replayedUpload.body)).toBe(200);
  expect(replayedUpload.body.media.id).toBe(firstUpload.body.media.id);
  expect(replayedUpload.body.replayed).toBe(true);
  expect(replayedUpload.replayed).toBe("true");

  const fullMedia = await page.request.get(firstUpload.body.media.url);
  expect(fullMedia.status()).toBe(200);
  expect(fullMedia.headers()["accept-ranges"]).toBe("bytes");
  expect(fullMedia.headers()["content-length"]).toBe("8");
  expect(Buffer.from(await fullMedia.body())).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );

  const rangedMedia = await page.request.get(firstUpload.body.media.url, {
    headers: { Range: "bytes=2-5" }
  });
  expect(rangedMedia.status()).toBe(206);
  expect(rangedMedia.headers()["content-range"]).toBe("bytes 2-5/8");
  expect(rangedMedia.headers()["content-length"]).toBe("4");
  expect(Buffer.from(await rangedMedia.body())).toEqual(
    Buffer.from([0x4e, 0x47, 0x0d, 0x0a])
  );

  const suffixMedia = await page.request.get(firstUpload.body.media.url, {
    headers: { Range: "bytes=-2" }
  });
  expect(suffixMedia.status()).toBe(206);
  expect(Buffer.from(await suffixMedia.body())).toEqual(
    Buffer.from([0x1a, 0x0a])
  );

  const headMedia = await page.request.head(firstUpload.body.media.url, {
    headers: { Range: "bytes=4-" }
  });
  expect(headMedia.status()).toBe(206);
  expect(headMedia.headers()["content-range"]).toBe("bytes 4-7/8");
  expect(headMedia.headers()["content-length"]).toBe("4");
  expect((await headMedia.body()).byteLength).toBe(0);

  const invalidRange = await page.request.get(firstUpload.body.media.url, {
    headers: { Range: "bytes=99-" }
  });
  expect(invalidRange.status()).toBe(416);
  expect(invalidRange.headers()["content-range"]).toBe("bytes */8");

  const postPayload = {
    type: "post",
    status: "published",
    title: "E2E Idempotent Post",
    slug: "e2e-idempotent-post",
    markdown: `## Verified\n\n![E2E image](${firstUpload.body.media.url})`,
    excerpt: "Isolated production E2E coverage.",
    cover: "",
    seoTitle: "",
    seoDescription: "",
    tags: "e2e,idempotency"
  };

  const missingPostKey = await page.evaluate(async (payload) => {
    const response = await fetch("/api/admin/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return { body: await response.json(), status: response.status };
  }, postPayload);
  expect(missingPostKey.status).toBe(400);
  expect(missingPostKey.body.code).toBe("INVALID_IDEMPOTENCY_KEY");

  const postKey = "e2e-post-create-key-0001";
  const createPost = (payload) =>
    page.evaluate(
      async ({ body, key }) => {
        const response = await fetch("/api/admin/posts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key
          },
          body: JSON.stringify(body)
        });
        return {
          body: await response.json(),
          replayed: response.headers.get("Idempotency-Replayed"),
          status: response.status
        };
      },
      { body: payload, key: postKey }
    );

  const firstPost = await createPost(postPayload);
  expect(firstPost.status, JSON.stringify(firstPost.body)).toBe(200);
  expect(firstPost.body).toMatchObject({ ok: true, replayed: false });

  const replayedPost = await createPost(postPayload);
  expect(replayedPost.status, JSON.stringify(replayedPost.body)).toBe(200);
  expect(replayedPost.body.id).toBe(firstPost.body.id);
  expect(replayedPost.body.replayed).toBe(true);
  expect(replayedPost.replayed).toBe("true");

  const conflictingPost = await createPost({
    ...postPayload,
    title: "Different payload"
  });
  expect(conflictingPost.status).toBe(409);
  expect(conflictingPost.body.code).toBe("IDEMPOTENCY_CONFLICT");

  await page.goto(`/posts/${postPayload.slug}`);
  await expect(
    page.getByRole("heading", { level: 1, name: postPayload.title })
  ).toBeVisible();

  const protectedDelete = await page.evaluate(async (id) => {
    const response = await fetch(`/api/admin/media/${id}`, {
      method: "DELETE"
    });
    return { body: await response.json(), status: response.status };
  }, firstUpload.body.media.id);
  expect(protectedDelete.status).toBe(409);
  expect(protectedDelete.body.code).toBe("MEDIA_IN_USE");
  expect(protectedDelete.body.referenceCount).toBeGreaterThan(0);

  const forcedDelete = await page.evaluate(async (id) => {
    const response = await fetch(`/api/admin/media/${id}?force=1`, {
      method: "DELETE"
    });
    return { body: await response.json(), status: response.status };
  }, firstUpload.body.media.id);
  expect(forcedDelete.status).toBe(200);
  expect(forcedDelete.body.ok).toBe(true);
  expect(forcedDelete.body.id).toBe(firstUpload.body.media.id);
  expect(forcedDelete.body.forcedReferenceCount).toBeGreaterThan(0);

  const deletedFile = await page.request.get(firstUpload.body.media.url);
  expect(deletedFile.status()).toBe(404);

  const reconciliation = await page.request.get("/api/admin/media/reconcile");
  expect(reconciliation.status()).toBe(200);
  await expect(reconciliation.json()).resolves.toMatchObject({
    ok: true,
    report: {
      missing: [],
      orphaned: []
    }
  });
});

test("public collections paginate and canonicalize real production routes", async ({
  page
}) => {
  test.setTimeout(60_000);
  await login(page);

  for (let index = 1; index <= 12; index += 1) {
    const title = `E2E Pagination ${String(index).padStart(2, "0")}`;
    const response = await page.request.post("/api/admin/posts", {
      headers: {
        "Idempotency-Key": `e2e-pagination-post-key-${String(index).padStart(2, "0")}`
      },
      data: {
        type: "post",
        status: "published",
        title,
        slug: `e2e-pagination-${index}`,
        markdown: `## ${title}\n\nBounded public collection fixture ${index}.`,
        excerpt: `Pagination fixture ${index}.`,
        cover: "",
        seoTitle: "",
        seoDescription: "",
        tags: "e2e,pagination"
      }
    });
    expect(response.status(), await response.text()).toBe(200);
  }

  await page.goto("/posts");
  await expect(page.getByText("E2E Pagination 12", { exact: true })).toBeVisible();
  await expect(
    page.getByText("E2E Idempotent Post", { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "集合分页" })
  ).toBeVisible();

  await page.goto("/posts?page=2");
  await expect(page).toHaveURL(/\/posts\?page=2$/);
  await expect(
    page.getByText("E2E Idempotent Post", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("E2E Pagination 12", { exact: true })).toHaveCount(
    0
  );

  await page.goto("/posts?page=1");
  await expect(page).toHaveURL(/\/posts$/);
  await page.goto("/posts?page=02");
  await expect(page).toHaveURL(/\/posts\?page=2$/);
  await page.goto("/posts?page=999999999");
  await expect(page).toHaveURL(/\/posts\?page=2$/);

  await page.goto("/archive?page=2");
  await expect(page).toHaveURL(/\/archive\?page=2$/);
  await expect(
    page.getByText("E2E Idempotent Post", { exact: true })
  ).toBeVisible();

  await page.goto("/tag/e2e?page=2");
  await expect(page).toHaveURL(/\/tag\/e2e\?page=2$/);
  await expect(
    page.getByText("E2E Idempotent Post", { exact: true })
  ).toBeVisible();
});

test("new post save races preserve newer edits and reach the canonical editor URL", async ({
  page
}) => {
  await login(page);
  await page.goto("/admin/posts/new");

  await page.getByLabel("标题", { exact: true }).fill("E2E raced draft");
  const slugInput = page.getByLabel("Slug", { exact: true });
  await slugInput.fill("e2e-raced-draft");
  const editor = page.locator(".markdown-editor");
  await editor.evaluate((element) => {
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  });
  await editor.press("Escape");
  await slugInput.click();
  await editor.evaluate((element) => {
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  });
  const beforeTabIndent = await editor.inputValue();
  await editor.press("Tab");
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(`${beforeTabIndent}  `);
  await editor.press("Escape");
  await editor.press("Tab");
  await expect(slugInput).toBeFocused();
  await editor.fill("## Initial\n\nSaved request body.");

  let releaseCreate;
  let markCreateStarted;
  const createGate = new Promise((resolve) => {
    releaseCreate = resolve;
  });
  const createStarted = new Promise((resolve) => {
    markCreateStarted = resolve;
  });
  let createRequests = 0;
  let updateRequests = 0;
  await page.route("**/api/admin/posts**", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      createRequests += 1;
      if (createRequests === 1) {
        markCreateStarted();
        await createGate;
      }
    } else if (method === "PUT") {
      updateRequests += 1;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await createStarted;
  await editor.evaluate((element) => {
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  });
  await editor.type("\n\nTyped while the create request was pending.");
  releaseCreate();

  await expect(
    page.getByText("已保存请求发出时的版本", { exact: false })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/posts\/new$/);
  await expect(editor).toHaveValue(/Typed while the create request was pending\.$/);
  await expect(page.locator(".editor-statusbar .chip.is-dirty")).toHaveText(
    "有未保存修改"
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("manjyun:admin-editor:pending-created-post")
      )
    )
    .toMatch(/^\d+$/);
  await page.evaluate(() => {
    localStorage.setItem("manjyun:admin-editor:draft:new", "stale-new-draft");
  });

  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.waitForURL(/\/admin\/posts\/\d+$/);
  expect(createRequests).toBe(1);
  expect(updateRequests).toBe(1);
  await expect(page.locator(".markdown-editor")).toHaveValue(
    /Typed while the create request was pending\.$/
  );
  await expect(page.locator(".editor-statusbar .chip.is-dirty")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("manjyun:admin-editor:pending-created-post")
      )
    )
    .toBeNull();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("manjyun:admin-editor:draft:new")
      )
    )
    .toBeNull();

  await page.reload();
  await expect(page.locator(".markdown-editor")).toHaveValue(
    /Typed while the create request was pending\.$/
  );
});

test("a raced first save can recover through the canonical editor after reload", async ({
  page
}) => {
  await login(page);
  await page.goto("/admin/posts/new");
  await page.getByLabel("标题", { exact: true }).fill("E2E recoverable draft");
  await page.getByLabel("Slug", { exact: true }).fill("e2e-recoverable-draft");
  const editor = page.locator(".markdown-editor");
  await editor.fill("## Before request");

  let releaseCreate;
  let markCreateStarted;
  const createGate = new Promise((resolve) => {
    releaseCreate = resolve;
  });
  const createStarted = new Promise((resolve) => {
    markCreateStarted = resolve;
  });
  let delayed = false;
  await page.route("**/api/admin/posts", async (route) => {
    if (!delayed && route.request().method() === "POST") {
      delayed = true;
      markCreateStarted();
      await createGate;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await createStarted;
  await editor.evaluate((element) => {
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  });
  await editor.type("\n\nRecovered after reload.");
  releaseCreate();
  await expect(
    page.getByText("已保存请求发出时的版本", { exact: false })
  ).toBeVisible();

  await page.reload();
  await page.waitForURL(/\/admin\/posts\/\d+$/);
  await expect(
    page.getByText("检测到未提交的本地草稿", { exact: true })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("manjyun:admin-editor:pending-created-post")
      )
    )
    .toBeNull();
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(page.locator(".markdown-editor")).toHaveValue(
    /Recovered after reload\.$/
  );
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.locator(".editor-statusbar .chip.is-dirty")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".markdown-editor")).toHaveValue(
    /Recovered after reload\.$/
  );
});

test("custom page and settings changes complete their public UI chains", async ({
  page
}) => {
  test.setTimeout(90_000);
  await login(page);

  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("About");

  await page.goto("/admin/pages");
  await expect(
    page.getByRole("heading", { level: 1, name: "独立页面" })
  ).toBeVisible();
  const aboutRow = page.locator(".content-table tbody tr").filter({
    has: page.locator("code", { hasText: "/about" })
  });
  await aboutRow.getByRole("link", { name: "编辑" }).click();
  await page.waitForURL(/\/admin\/pages\/\d+$/);
  const aboutId = Number(new URL(page.url()).pathname.split("/").at(-1));
  expect(aboutId).toBeGreaterThan(0);

  await page.getByRole("button", { name: "写作", exact: true }).click();
  const aboutEditor = page.locator(".markdown-editor");
  await expect(
    page.getByRole("toolbar", { name: "Markdown 格式工具栏" })
  ).toBeVisible();
  await aboutEditor.fill([
    "# About",
    "",
    "# Services",
    "",
    "NAS 上目前跑着的服务：",
    "[code:C++]",
    "#include <iostream>",
    "int main() { return 0; }",
    "[/code]",
    "",
    "~~retired~~",
    "",
    "| Service | State |",
    "| :--- | ---: |",
    "| mblog-app | ready |",
    "",
    "> [!IMPORTANT]",
    "> Keep backups."
  ].join("\n"));
  await aboutEditor.evaluate((element) => {
    const start = element.value.indexOf("NAS");
    element.focus();
    element.setSelectionRange(start, start + 3);
  });
  await page.getByRole("button", { name: /加粗（/ }).click();
  await expect(aboutEditor).toHaveValue(/\*\*NAS\*\* 上目前跑着的服务：/);

  await page.getByRole("button", { name: "分栏", exact: true }).click();
  const aboutPreview = page.locator(".preview-pane");
  await expect(aboutPreview.locator("h1")).toHaveCount(0);
  await expect(
    aboutPreview.getByRole("heading", { level: 2, name: "Services" })
  ).toBeVisible();
  await expect(
    aboutPreview.locator("pre.mj-code-block code.language-cpp")
  ).toContainText("int main()");
  await expect(aboutPreview.locator("del")).toHaveText("retired");
  await expect(aboutPreview.locator('th[align="right"]')).toHaveText("State");
  await expect(aboutPreview.locator(".mj-callout-card.important")).toContainText(
    "Keep backups."
  );

  let releaseSave;
  let markSaveStarted;
  const saveGate = new Promise((resolve) => {
    releaseSave = resolve;
  });
  const saveStarted = new Promise((resolve) => {
    markSaveStarted = resolve;
  });
  let delayNextSave = true;
  await page.route(`**/api/admin/posts/${aboutId}`, async (route) => {
    if (delayNextSave && route.request().method() === "PUT") {
      delayNextSave = false;
      markSaveStarted();
      await saveGate;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "保存更改", exact: true }).click();
  await saveStarted;
  await aboutEditor.evaluate((element) => {
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  });
  await aboutEditor.type("\n\n保存期间的新修改。");
  const aboutSlug = page.getByLabel("Slug", { exact: true });
  await aboutSlug.fill("about-unsaved-change");
  releaseSave();
  await expect(
    page.getByText("已保存请求发出时的版本", { exact: false })
  ).toBeVisible();
  await expect(aboutEditor).toHaveValue(/保存期间的新修改。$/);
  await expect(aboutSlug).toHaveValue("about-unsaved-change");
  await expect(page.locator(".editor-statusbar .chip.is-dirty")).toHaveText(
    "有未保存修改"
  );
  await expect
    .poll(() =>
      page.evaluate(
        (id) => localStorage.getItem(`manjyun:admin-editor:draft:${id}`),
        aboutId
      )
    )
    .not.toBeNull();

  await aboutSlug.fill("about");
  await page.getByRole("button", { name: "保存更改", exact: true }).click();
  await expect(page.locator(".editor-statusbar .chip.is-dirty")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        (id) => localStorage.getItem(`manjyun:admin-editor:draft:${id}`),
        aboutId
      )
    )
    .toBeNull();

  await page.goto("/about");
  await expect(
    page.getByRole("heading", { level: 1, name: "About" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Services" })
  ).toBeVisible();
  await expect(page.locator("pre.mj-code-block code.language-cpp")).toContainText(
    "int main()"
  );
  await expect(page.locator("del")).toHaveText("retired");
  await expect(page.locator('th[align="right"]')).toHaveText("State");
  await expect(page.locator(".mj-callout-card.important")).toContainText(
    "Keep backups."
  );
  await expect(page.locator("body")).not.toContainText("[code:C++]");
  await expect(page.getByText("保存期间的新修改。", { exact: true })).toBeVisible();

  await page.goto("/admin/pages");
  await page.getByLabel("页面标题").fill("E2E Standalone Page");
  await page.getByLabel("Slug（可留空）").fill("e2e-standalone-page");
  await page.getByRole("button", { name: "创建草稿并编辑" }).click();
  await page.waitForURL(/\/admin\/pages\/\d+$/);
  const pageId = Number(new URL(page.url()).pathname.split("/").at(-1));
  expect(pageId).toBeGreaterThan(0);

  await page.getByRole("button", { name: "写作", exact: true }).click();
  await page
    .locator(".markdown-editor")
    .fill("## Production chain\n\nThis page was created through the page workspace.");
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await expect(page.locator(".editor-statusbar .status-pill")).toHaveText("已发布");

  const malformedRevisionCursor = await page.request.get(
    `/api/admin/posts/${pageId}/revisions?cursor=malformed`
  );
  expect(malformedRevisionCursor.status()).toBe(400);
  await expect(malformedRevisionCursor.json()).resolves.toMatchObject({
    ok: false,
    code: "INVALID_REQUEST"
  });

  const trashTrigger = page.getByRole("button", {
    name: "移到回收站",
    exact: true
  });
  await trashTrigger.focus();
  await trashTrigger.click();
  const confirmation = page.getByRole("alertdialog");
  const cancelConfirmation = confirmation.getByRole("button", {
    name: "取消",
    exact: true
  });
  const confirmTrash = confirmation.getByRole("button", {
    name: "移到回收站",
    exact: true
  });
  await expect(confirmation).toBeVisible();
  await expect(cancelConfirmation).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirmTrash).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancelConfirmation).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirmTrash).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(trashTrigger).toBeFocused();

  await page.goto("/e2e-standalone-page");
  await expect(
    page.getByRole("heading", { level: 1, name: "E2E Standalone Page" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Production chain" })
  ).toBeVisible();

  await page.goto("/admin/settings");
  const generalSettings = page.locator("#settings-general");
  const titleInput = generalSettings.locator("input").nth(0);
  await titleInput.fill("ManJyun E2E");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByText("设置已保存", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("ManJyun E2E", { exact: true }).first()).toBeVisible();

  const activatePayload = {
    action: "activate",
    themeId: "neon-rift",
    expectedActiveTheme: "manjyun-console"
  };
  const activateKey = "e2e-theme-activate-key-0001";
  const activateNeon = await page.request.post("/api/admin/themes", {
    headers: { "Idempotency-Key": activateKey },
    data: activatePayload
  });
  expect(activateNeon.status()).toBe(200);
  const replayActivate = await page.request.post("/api/admin/themes", {
    headers: { "Idempotency-Key": activateKey },
    data: activatePayload
  });
  expect(replayActivate.status()).toBe(200);
  expect(replayActivate.headers()["idempotency-replayed"]).toBe("true");
  await page.goto("/");
  const tower = page.locator(".rift-tower picture img");
  await expect(tower).toBeVisible();
  await tower.evaluate((image) => image.decode());
  await expect
    .poll(() => tower.evaluate((image) => image.currentSrc))
    .toMatch(/signal-tower-(?:432|864)\.avif$/);

  const rollbackPayload = {
    action: "rollback",
    themeId: "manjyun-console",
    expectedActiveTheme: "neon-rift"
  };
  const rollbackKey = "e2e-theme-rollback-key-0001";
  const rollbackTheme = await page.request.post("/api/admin/themes", {
    headers: { "Idempotency-Key": rollbackKey },
    data: rollbackPayload
  });
  expect(rollbackTheme.status()).toBe(200);
  const replayRollback = await page.request.post("/api/admin/themes", {
    headers: { "Idempotency-Key": rollbackKey },
    data: rollbackPayload
  });
  expect(replayRollback.status()).toBe(200);
  expect(replayRollback.headers()["idempotency-replayed"]).toBe("true");
  await expect(replayRollback.json()).resolves.toMatchObject({
    ok: true,
    activeTheme: "manjyun-console",
    previousTheme: "neon-rift"
  });
});

test("password change revokes the old credential and logout remains functional", async ({
  page
}) => {
  test.setTimeout(60_000);
  await login(page);

  await page.goto("/admin/account");
  await page.getByLabel("当前密码").fill(password);
  await page.getByLabel("新密码", { exact: true }).fill(changedPassword);
  await page.getByLabel("确认新密码").fill(changedPassword);
  await page
    .getByRole("button", { name: "更新密码并撤销其他会话" })
    .click();
  await expect(
    page.locator(".admin-notice.success[role='status']")
  ).toContainText("密码已更新");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin$/);

  await page.getByRole("button", { name: "退出登录" }).click();
  await page.waitForURL("**/admin/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(
    page.locator(".admin-notice[role='alert']")
  ).toContainText("用户名或密码错误");

  await login(page, changedPassword);
  await expect(page).toHaveURL(/\/admin$/);
});
