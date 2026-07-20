import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPersistentOperationKey,
  persistentOperationKey,
  requestJson
} from "@/lib/http/client-api";

test("client API helper distinguishes rejected and unknown write outcomes", async () => {
  const success = await requestJson<{ ok: true; id: number }>(
    "https://example.test/write",
    { method: "POST" },
    {
      fetcher: (async () =>
        new Response(JSON.stringify({ ok: true, id: 7 }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })) as typeof fetch
    }
  );
  assert.deepEqual(success, {
    ok: true,
    data: { ok: true, id: 7 },
    status: 200
  });

  const rejected = await requestJson(
    "https://example.test/write",
    { method: "POST" },
    {
      fallbackMessage: "保存失败",
      fetcher: (async () =>
        new Response(
          JSON.stringify({
            ok: false,
            code: "VALIDATION_ERROR",
            error: "标题不能为空"
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        )) as typeof fetch
    }
  );
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.outcome, "rejected");
    assert.equal(rejected.code, "VALIDATION_ERROR");
    assert.equal(rejected.message, "标题不能为空");
  }

  const nonJsonSuccess = await requestJson(
    "https://example.test/write",
    { method: "POST" },
    {
      fetcher: (async () =>
        new Response("<html>proxy error</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" }
        })) as typeof fetch
    }
  );
  assert.equal(nonJsonSuccess.ok, false);
  if (!nonJsonSuccess.ok) {
    assert.equal(nonJsonSuccess.outcome, "unknown");
    assert.match(nonJsonSuccess.message, /结果未知/);
  }

  const networkFailure = await requestJson(
    "https://example.test/write",
    { method: "POST" },
    {
      fetcher: (async () => {
        throw new TypeError("connection reset");
      }) as typeof fetch
    }
  );
  assert.equal(networkFailure.ok, false);
  if (!networkFailure.ok) {
    assert.equal(networkFailure.status, null);
    assert.equal(networkFailure.outcome, "unknown");
    assert.match(networkFailure.message, /结果未知/);
  }

  const nonJsonError = await requestJson(
    "https://example.test/write",
    { method: "POST" },
    {
      fallbackMessage: "删除失败",
      fetcher: (async () =>
        new Response("Bad Gateway", {
          status: 502,
          headers: { "Content-Type": "text/plain" }
        })) as typeof fetch
    }
  );
  assert.equal(nonJsonError.ok, false);
  if (!nonJsonError.ok) {
    assert.equal(nonJsonError.outcome, "rejected");
    assert.equal(nonJsonError.message, "删除失败（HTTP 502）");
  }

  const unauthorized = await requestJson(
    "https://example.test/write",
    { method: "POST" },
    {
      fetcher: (async () =>
        new Response(
          JSON.stringify({
            ok: false,
            code: "UNAUTHORIZED",
            error: "Unauthorized"
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" }
          }
        )) as typeof fetch
    }
  );
  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) {
    assert.equal(unauthorized.message, "登录状态已失效，请重新登录。");
  }
});

test("persistent operation keys are reused only for the same payload", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    }
  };
  const first = persistentOperationKey(storage, "operation", "{\"title\":\"A\"}");
  const replay = persistentOperationKey(storage, "operation", "{\"title\":\"A\"}");
  const changed = persistentOperationKey(storage, "operation", "{\"title\":\"B\"}");
  assert.equal(replay, first);
  assert.notEqual(changed, first);
  clearPersistentOperationKey(storage, "operation");
  assert.equal(values.has("operation"), false);
});
