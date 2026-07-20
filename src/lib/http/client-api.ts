export type ApiErrorPayload = {
  ok?: false;
  code?: string;
  error?: string;
  [key: string]: unknown;
};

export type JsonRequestResult<T> =
  | {
      ok: true;
      data: T;
      status: number;
    }
  | {
      ok: false;
      status: number | null;
      code?: string;
      data: ApiErrorPayload | null;
      outcome: "rejected" | "unknown";
      message: string;
    };

type RequestJsonOptions = {
  fallbackMessage?: string;
  operation?: "read" | "write";
  fetcher?: typeof fetch;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Fetch a JSON API without turning network failures or HTML error pages into
 * unhandled response.json() exceptions. For writes, a network failure or an
 * unparseable 2xx response is deliberately reported as "unknown": the server
 * may already have committed the operation.
 */
export async function requestJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: RequestJsonOptions = {}
): Promise<JsonRequestResult<T>> {
  const operation = options.operation ?? "write";
  const fallbackMessage = options.fallbackMessage ?? "请求失败";
  const fetcher = options.fetcher ?? fetch;
  let response: Response;

  try {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    response = await fetcher(input, { ...init, headers });
  } catch {
    return {
      ok: false,
      status: null,
      data: null,
      outcome: operation === "write" ? "unknown" : "rejected",
      message:
        operation === "write"
          ? "网络异常，操作结果未知；请重试同一操作或刷新页面确认。"
          : "网络异常，请稍后重试。"
    };
  }

  const raw = await response.text().catch(() => "");
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = null;
    }
  }

  if (response.ok && parsed !== null) {
    if (isObject(parsed) && parsed.ok === false) {
      const data = parsed as ApiErrorPayload;
      return {
        ok: false,
        status: response.status,
        code: typeof data.code === "string" ? data.code : undefined,
        data,
        outcome: "rejected",
        message:
          typeof data.error === "string" && data.error
            ? data.error
            : fallbackMessage
      };
    }
    return { ok: true, data: parsed as T, status: response.status };
  }

  const data = isObject(parsed) ? (parsed as ApiErrorPayload) : null;
  const serverMessage =
    typeof data?.error === "string" && data.error ? data.error : null;
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      code: typeof data?.code === "string" ? data.code : undefined,
      data,
      outcome: "rejected",
      message:
        response.status === 401
          ? "登录状态已失效，请重新登录。"
          : serverMessage ?? `${fallbackMessage}（HTTP ${response.status}）`
    };
  }

  return {
    ok: false,
    status: response.status,
    data,
    outcome: operation === "write" ? "unknown" : "rejected",
    message:
      operation === "write"
        ? "服务器返回了无法识别的成功响应，操作结果未知；请重试同一操作或刷新页面确认。"
        : "服务器返回了无法识别的响应。"
  };
}

export function createIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

type StoredOperationKey = {
  key: string;
  payload: string;
};

/**
 * Keep the key for an identical request across a page refresh. If the payload
 * changes after a known validation error, a new key is generated so the
 * server can correctly treat it as a different operation.
 */
export function persistentOperationKey(
  storage: Pick<Storage, "getItem" | "setItem">,
  storageKey: string,
  payload: string
) {
  try {
    const stored = JSON.parse(storage.getItem(storageKey) ?? "null") as
      | StoredOperationKey
      | null;
    if (
      stored &&
      typeof stored.key === "string" &&
      stored.key &&
      stored.payload === payload
    ) {
      return stored.key;
    }
  } catch {
    // Corrupt or unavailable optional client storage must not block a write.
  }

  const key = createIdempotencyKey();
  try {
    storage.setItem(storageKey, JSON.stringify({ key, payload }));
  } catch {
    // In-memory use of the returned key still protects the current request.
  }
  return key;
}

export function clearPersistentOperationKey(
  storage: Pick<Storage, "removeItem">,
  storageKey: string
) {
  try {
    storage.removeItem(storageKey);
  } catch {
    // Client persistence is a reliability aid, not a prerequisite.
  }
}
