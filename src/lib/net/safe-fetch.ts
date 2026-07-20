import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { performance } from "node:perf_hooks";
import tls from "node:tls";
import { proxyForUrl } from "@/lib/net/proxy";
import { tunneledHttpsRequestOptions } from "@/lib/net/tunnel";

export type SafeFetchErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "TARGET_NOT_PUBLIC"
  | "DNS_RESOLUTION_FAILED"
  | "INVALID_DNS_RESPONSE"
  | "INVALID_REDIRECT"
  | "TOO_MANY_REDIRECTS"
  | "REQUEST_TIMEOUT"
  | "RESPONSE_TOO_LARGE";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: SafeFetchErrorCode,
    message: string,
    {
      status = 502,
      details = {},
      cause
    }: {
      status?: number;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {}
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SafeFetchError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class TimeoutError extends SafeFetchError {
  constructor() {
    super("REQUEST_TIMEOUT", "Request timed out.", { status: 504 });
    this.name = "TimeoutError";
  }
}

class ResponseTooLargeError extends SafeFetchError {
  constructor(maxBytes: number) {
    super("RESPONSE_TOO_LARGE", "Response is too large.", {
      status: 502,
      details: { maxBytes }
    });
    this.name = "ResponseTooLargeError";
  }
}

export type FetchResult = {
  ok: boolean;
  status: number;
  url: string;
  headers: Map<string, string>;
  body: Buffer;
};

export type ResolvedTarget = {
  address: string;
  family: 4 | 6;
};

export type LookupAll = (
  hostname: string,
  options: { all: true; verbatim: true }
) => Promise<ReadonlyArray<{ address: string; family: number }>>;

export type SafeFetchOptions = {
  accept: string;
  timeoutMs: number;
  maxBytes: number;
  redirects?: number;
};

export type SafeFetchTransport = (
  target: URL,
  resolved: ResolvedTarget,
  proxy: URL | null,
  headers: Record<string, string>,
  timeoutMs: number,
  maxBytes: number
) => Promise<FetchResult>;

export type SafeFetchDependencies = {
  lookup?: LookupAll;
  proxySelector?: (target: URL) => URL | null;
  transport?: SafeFetchTransport;
};

const ipv4BlockedRanges: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], // Current network and unspecified.
  [0x0a000000, 8], // Private-use.
  [0x64400000, 10], // Shared address space.
  [0x7f000000, 8], // Loopback.
  [0xa9fe0000, 16], // Link-local.
  [0xac100000, 12], // Private-use.
  [0xc0000000, 24], // IETF protocol assignments.
  [0xc0000200, 24], // Documentation.
  [0xc0586300, 24], // Deprecated 6to4 relay anycast.
  [0xc0a80000, 16], // Private-use.
  [0xc6120000, 15], // Benchmarking.
  [0xc6336400, 24], // Documentation.
  [0xcb007100, 24], // Documentation.
  [0xe0000000, 4], // Multicast.
  [0xf0000000, 4] // Reserved and limited broadcast.
];

function ipv4ToNumber(input: string) {
  const octets = input.split(".");
  if (octets.length !== 4) return null;

  let value = 0;
  for (const octet of octets) {
    if (!/^(0|[1-9]\d{0,2})$/.test(octet)) return null;
    const number = Number(octet);
    if (number > 255) return null;
    value = (value * 256 + number) >>> 0;
  }
  return value;
}

function matchesIpv4Prefix(value: number, network: number, prefix: number) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (network & mask);
}

function isPublicIpv4Number(value: number) {
  return !ipv4BlockedRanges.some(([network, prefix]) =>
    matchesIpv4Prefix(value, network, prefix)
  );
}

function ipv6ToBigInt(input: string) {
  let normalized = input.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.includes("%")) return null;

  const ipv4Tail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const ipv4 = ipv4ToNumber(ipv4Tail);
    if (ipv4 === null) return null;
    const high = ((ipv4 >>> 16) & 0xffff).toString(16);
    const low = (ipv4 & 0xffff).toString(16);
    normalized = normalized.slice(0, -ipv4Tail.length) + `${high}:${low}`;
  }

  const compressed = normalized.split("::");
  if (compressed.length > 2) return null;

  const left = compressed[0] ? compressed[0].split(":") : [];
  const right = compressed.length === 2 && compressed[1] ? compressed[1].split(":") : [];
  if (
    [...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part)) ||
    (compressed.length === 1 && left.length !== 8)
  ) {
    return null;
  }

  const missing = 8 - left.length - right.length;
  if (missing < (compressed.length === 2 ? 1 : 0)) return null;
  const parts = [...left, ...Array(missing).fill("0"), ...right];
  if (parts.length !== 8) return null;

  return parts.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n);
}

function matchesIpv6Prefix(value: bigint, network: bigint, prefix: number) {
  if (prefix === 0) return true;
  const shift = 128n - BigInt(prefix);
  return value >> shift === network >> shift;
}

const ipv6GlobalUnicast = ipv6ToBigInt("2000::")!;
const ipv6IetfSpecial = ipv6ToBigInt("2001::")!;
const ipv6Documentation = ipv6ToBigInt("2001:db8::")!;
const ipv6SixToFour = ipv6ToBigInt("2002::")!;
const ipv6DocumentationSecond = ipv6ToBigInt("3fff::")!;
const ipv6MappedPrefix = ipv6ToBigInt("::ffff:0:0")!;
const ipv6Nat64Prefix = ipv6ToBigInt("64:ff9b::")!;

function isPublicIpv6Number(value: bigint) {
  if (matchesIpv6Prefix(value, ipv6MappedPrefix, 96)) {
    return isPublicIpv4Number(Number(value & 0xffffffffn));
  }

  // The well-known NAT64 prefix is safe only when its embedded IPv4 target is public.
  if (matchesIpv6Prefix(value, ipv6Nat64Prefix, 96)) {
    return isPublicIpv4Number(Number(value & 0xffffffffn));
  }

  if (!matchesIpv6Prefix(value, ipv6GlobalUnicast, 3)) return false;
  if (matchesIpv6Prefix(value, ipv6IetfSpecial, 23)) return false;
  if (matchesIpv6Prefix(value, ipv6Documentation, 32)) return false;
  if (matchesIpv6Prefix(value, ipv6SixToFour, 16)) return false;
  if (matchesIpv6Prefix(value, ipv6DocumentationSecond, 20)) return false;
  return true;
}

function unwrapHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

export function isPublicIpAddress(input: string) {
  const address = unwrapHostname(input);
  const family = net.isIP(address);
  if (family === 4) {
    const value = ipv4ToNumber(address);
    return value !== null && isPublicIpv4Number(value);
  }
  if (family === 6) {
    const value = ipv6ToBigInt(address);
    return value !== null && isPublicIpv6Number(value);
  }
  return false;
}

function validateTargetUrl(target: URL) {
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new SafeFetchError("UNSUPPORTED_PROTOCOL", "Only HTTP(S) targets are allowed.", {
      status: 400,
      details: { protocol: target.protocol }
    });
  }
  if (!target.hostname) {
    throw new SafeFetchError("INVALID_URL", "Target URL has no hostname.", {
      status: 400
    });
  }
  if (target.username || target.password) {
    throw new SafeFetchError("INVALID_URL", "Credentials in target URLs are not allowed.", {
      status: 400
    });
  }
}

const defaultLookup: LookupAll = (hostname, options) =>
  dns.promises.lookup(hostname, options);

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  if (timeoutMs <= 0) throw new TimeoutError();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError()), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolvePublicTargets(
  target: URL,
  lookup: LookupAll = defaultLookup,
  timeoutMs?: number
): Promise<ResolvedTarget[]> {
  validateTargetUrl(target);
  const hostname = unwrapHostname(target.hostname);
  const literalFamily = net.isIP(hostname);

  if (literalFamily) {
    if (!isPublicIpAddress(hostname)) {
      throw new SafeFetchError("TARGET_NOT_PUBLIC", "Target address is not public.", {
        status: 400,
        details: { hostname, address: hostname }
      });
    }
    return [{ address: hostname, family: literalFamily as 4 | 6 }];
  }

  let answers: ReadonlyArray<{ address: string; family: number }>;
  try {
    const lookupOperation = lookup(hostname, { all: true, verbatim: true });
    answers =
      timeoutMs === undefined
        ? await lookupOperation
        : await withTimeout(lookupOperation, timeoutMs);
  } catch (error) {
    if (error instanceof TimeoutError) throw error;
    throw new SafeFetchError("DNS_RESOLUTION_FAILED", "Target hostname could not be resolved.", {
      status: 502,
      details: { hostname },
      cause: error
    });
  }

  if (!answers.length) {
    throw new SafeFetchError("DNS_RESOLUTION_FAILED", "Target hostname returned no addresses.", {
      status: 502,
      details: { hostname }
    });
  }

  const normalized = answers.map(({ address, family }) => {
    const cleanAddress = unwrapHostname(address);
    const detectedFamily = net.isIP(cleanAddress);
    if (
      (family !== 4 && family !== 6) ||
      detectedFamily !== family
    ) {
      throw new SafeFetchError("INVALID_DNS_RESPONSE", "Resolver returned an invalid address.", {
        status: 502,
        details: { hostname }
      });
    }
    return { address: cleanAddress, family: family as 4 | 6 };
  });

  const blocked = normalized.find(({ address }) => !isPublicIpAddress(address));
  if (blocked) {
    throw new SafeFetchError("TARGET_NOT_PUBLIC", "Target hostname resolves to a non-public address.", {
      status: 400,
      details: { hostname, address: blocked.address }
    });
  }

  // Keep DNS order while removing duplicates. Every candidate was validated
  // above, and the transport receives an exact address rather than resolving
  // the hostname again.
  return normalized.filter(
    (candidate, index, values) =>
      values.findIndex(
        (value) =>
          value.address === candidate.address && value.family === candidate.family
      ) === index
  );
}

export async function resolvePublicTarget(
  target: URL,
  lookup: LookupAll = defaultLookup,
  timeoutMs?: number
): Promise<ResolvedTarget> {
  return (await resolvePublicTargets(target, lookup, timeoutMs))[0];
}

function headersFromResponse(headers: http.IncomingHttpHeaders) {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      map.set(key.toLowerCase(), value.join(", "));
    } else if (value !== undefined) {
      map.set(key.toLowerCase(), String(value));
    }
  }
  return map;
}

function proxyAuthHeader(proxy: URL) {
  if (!proxy.username) return null;
  return `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`;
}

function collectResponse(
  response: http.IncomingMessage,
  finalUrl: string,
  maxBytes: number
) {
  return new Promise<FetchResult>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    response.on("data", (chunk: Buffer | Uint8Array) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        response.destroy(new ResponseTooLargeError(maxBytes));
        return;
      }
      chunks.push(buffer);
    });
    response.on("end", () => {
      resolve({
        ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
        status: response.statusCode ?? 0,
        url: finalUrl,
        headers: headersFromResponse(response.headers),
        body: Buffer.concat(chunks)
      });
    });
    response.on("error", reject);
  });
}

function requestWithTotalTimeout(
  createRequest: (
    onResponse: (response: http.IncomingMessage) => void
  ) => http.ClientRequest,
  finalUrl: string,
  timeoutMs: number,
  maxBytes: number
) {
  return new Promise<FetchResult>((resolve, reject) => {
    if (timeoutMs <= 0) {
      reject(new TimeoutError());
      return;
    }

    let response: http.IncomingMessage | null = null;
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    const finish = (
      callback: (value: FetchResult | PromiseLike<FetchResult>) => void,
      value: FetchResult
    ) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    };

    let request: http.ClientRequest;
    const abort = (error: TimeoutError) => {
      if (settled) return;
      fail(error);
      response?.destroy(error);
      request.destroy(error);
    };

    request = createRequest((incoming) => {
      response = incoming;
      collectResponse(incoming, finalUrl, maxBytes)
        .then((result) => finish(resolve, result))
        .catch(fail);
    });
    timer = setTimeout(() => abort(new TimeoutError()), timeoutMs);
    request.on("timeout", () => abort(new TimeoutError()));
    request.on("error", fail);
    request.end();
  });
}

function targetHeaders(target: URL, headers: Record<string, string>) {
  return {
    ...headers,
    Host: target.host,
    Connection: "close"
  };
}

export function directRequestOptions(
  target: URL,
  resolved: ResolvedTarget,
  headers: Record<string, string>,
  timeoutMs: number
): https.RequestOptions {
  const originalHostname = unwrapHostname(target.hostname);
  return {
    protocol: target.protocol,
    hostname: resolved.address,
    family: resolved.family,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    method: "GET",
    headers: targetHeaders(target, headers),
    ...(target.protocol === "https:" && net.isIP(originalHostname) === 0
      ? { servername: originalHostname }
      : {}),
    timeout: timeoutMs
  };
}

function formatIpForAuthority(resolved: ResolvedTarget) {
  return resolved.family === 6 ? `[${resolved.address}]` : resolved.address;
}

export function pinnedHttpProxyPath(target: URL, resolved: ResolvedTarget) {
  const port = target.port ? `:${target.port}` : "";
  return `${target.protocol}//${formatIpForAuthority(resolved)}${port}${target.pathname}${target.search}`;
}

export function pinnedConnectAuthority(target: URL, resolved: ResolvedTarget) {
  return `${formatIpForAuthority(resolved)}:${target.port || 443}`;
}

export function httpProxyRequestOptions(
  target: URL,
  resolved: ResolvedTarget,
  proxy: URL,
  headers: Record<string, string>,
  timeoutMs: number
): https.RequestOptions {
  const auth = proxyAuthHeader(proxy);
  return {
    protocol: proxy.protocol,
    hostname: proxy.hostname,
    port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
    path: pinnedHttpProxyPath(target, resolved),
    method: "GET",
    headers: {
      ...targetHeaders(target, headers),
      ...(auth ? { "Proxy-Authorization": auth } : {})
    },
    timeout: timeoutMs
  };
}

export function proxyConnectRequestOptions(
  target: URL,
  resolved: ResolvedTarget,
  proxy: URL,
  timeoutMs: number
): https.RequestOptions {
  const auth = proxyAuthHeader(proxy);
  const authority = pinnedConnectAuthority(target, resolved);
  return {
    hostname: proxy.hostname,
    port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
    method: "CONNECT",
    path: authority,
    headers: {
      Host: authority,
      ...(auth ? { "Proxy-Authorization": auth } : {})
    },
    timeout: timeoutMs
  };
}

export function tunneledTlsOptions(
  target: URL,
  socket: NonNullable<tls.ConnectionOptions["socket"]>
): tls.ConnectionOptions {
  const originalHostname = unwrapHostname(target.hostname);
  return {
    socket,
    ...(net.isIP(originalHostname) === 0 ? { servername: originalHostname } : {}),
    // CONNECT is pinned to an IP, but certificate identity remains the original URL host.
    checkServerIdentity: (_hostname, certificate) =>
      tls.checkServerIdentity(originalHostname, certificate)
  };
}

function requestDirect(
  target: URL,
  resolved: ResolvedTarget,
  headers: Record<string, string>,
  timeoutMs: number,
  maxBytes: number
) {
  const client = target.protocol === "https:" ? https : http;
  return requestWithTotalTimeout(
    (onResponse) =>
      client.request(
        directRequestOptions(target, resolved, headers, timeoutMs),
        onResponse
      ),
    target.toString(),
    timeoutMs,
    maxBytes
  );
}

function requestHttpViaProxy(
  target: URL,
  resolved: ResolvedTarget,
  proxy: URL,
  headers: Record<string, string>,
  timeoutMs: number,
  maxBytes: number
) {
  const proxyClient = proxy.protocol === "https:" ? https : http;
  return requestWithTotalTimeout(
    (onResponse) =>
      proxyClient.request(
        httpProxyRequestOptions(
          target,
          resolved,
          proxy,
          headers,
          timeoutMs
        ),
        onResponse
      ),
    target.toString(),
    timeoutMs,
    maxBytes
  );
}

function requestHttpsViaProxy(
  target: URL,
  resolved: ResolvedTarget,
  proxy: URL,
  headers: Record<string, string>,
  timeoutMs: number,
  maxBytes: number
) {
  return new Promise<FetchResult>((resolve, reject) => {
    if (timeoutMs <= 0) {
      reject(new TimeoutError());
      return;
    }

    const proxyClient = proxy.protocol === "https:" ? https : http;
    let secureSocket: tls.TLSSocket | null = null;
    let tunneledRequest: http.ClientRequest | null = null;
    let tunneledResponse: http.IncomingMessage | null = null;
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    const finish = (
      callback: (value: FetchResult | PromiseLike<FetchResult>) => void,
      value: FetchResult
    ) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    };

    const connectRequest = proxyClient.request(
      proxyConnectRequestOptions(target, resolved, proxy, timeoutMs)
    );
    const abort = (error: TimeoutError) => {
      if (settled) return;
      fail(error);
      tunneledResponse?.destroy(error);
      tunneledRequest?.destroy(error);
      secureSocket?.destroy(error);
      connectRequest.destroy(error);
    };
    timer = setTimeout(() => abort(new TimeoutError()), timeoutMs);

    connectRequest.on("connect", (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        fail(new Error(`Proxy CONNECT returned ${response.statusCode}`));
        return;
      }

      secureSocket = tls.connect(tunneledTlsOptions(target, socket));
      secureSocket.setTimeout(timeoutMs, () => {
        abort(new TimeoutError());
      });
      secureSocket.on("error", fail);
      secureSocket.on("secureConnect", () => {
        // The HTTPS request below owns the timeout after the TLS handshake.
        secureSocket!.setTimeout(0);
        tunneledRequest = https.request(
          tunneledHttpsRequestOptions(
            target,
            headers,
            secureSocket!,
            timeoutMs
          ),
          (response) => {
            tunneledResponse = response;
            collectResponse(response, target.toString(), maxBytes)
              .then((result) => finish(resolve, result))
              .catch(fail);
          }
        );
        tunneledRequest.on("timeout", () => abort(new TimeoutError()));
        tunneledRequest.on("error", fail);
        tunneledRequest.end();
      });
    });
    connectRequest.on("timeout", () => abort(new TimeoutError()));
    connectRequest.on("error", fail);
    connectRequest.end();
  });
}

async function defaultTransport(
  target: URL,
  resolved: ResolvedTarget,
  proxy: URL | null,
  headers: Record<string, string>,
  timeoutMs: number,
  maxBytes: number
) {
  if (!proxy) {
    return requestDirect(target, resolved, headers, timeoutMs, maxBytes);
  }
  if (target.protocol === "http:") {
    return requestHttpViaProxy(target, resolved, proxy, headers, timeoutMs, maxBytes);
  }
  return requestHttpsViaProxy(target, resolved, proxy, headers, timeoutMs, maxBytes);
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export async function fetchUrlSafely(
  input: string,
  {
    accept,
    timeoutMs,
    maxBytes,
    redirects = 4
  }: SafeFetchOptions,
  dependencies: SafeFetchDependencies = {}
): Promise<FetchResult> {
  let target: URL;
  try {
    target = new URL(input);
  } catch (error) {
    throw new SafeFetchError("INVALID_URL", "Target URL is invalid.", {
      status: 400,
      cause: error
    });
  }

  const lookup = dependencies.lookup ?? defaultLookup;
  const proxySelector = dependencies.proxySelector ?? proxyForUrl;
  const transport = dependencies.transport ?? defaultTransport;
  const headers = {
    Accept: accept,
    "User-Agent": "Mozilla/5.0 ManJyunBlog/0.1 favicon fetcher"
  };
  let remainingRedirects = redirects;
  let hop = 0;
  const deadline = performance.now() + timeoutMs;

  while (true) {
    const remainingBeforeLookup = Math.ceil(deadline - performance.now());
    const resolvedTargets = await resolvePublicTargets(
      target,
      lookup,
      remainingBeforeLookup
    );
    const proxy = proxySelector(target);
    let result: FetchResult | null = null;
    let lastTransportError: unknown;
    for (const resolved of resolvedTargets) {
      const remainingForTransport = Math.ceil(deadline - performance.now());
      if (remainingForTransport <= 0) throw new TimeoutError();
      try {
        result = await withTimeout(
          transport(
            target,
            resolved,
            proxy,
            headers,
            remainingForTransport,
            maxBytes
          ),
          remainingForTransport
        );
        break;
      } catch (error) {
        if (error instanceof ResponseTooLargeError) throw error;
        if (error instanceof TimeoutError) throw error;
        lastTransportError = error;
      }
    }
    if (!result) {
      throw lastTransportError ?? new SafeFetchError(
        "DNS_RESOLUTION_FAILED",
        "No validated target address was reachable.",
        { status: 502 }
      );
    }

    if (!redirectStatuses.has(result.status)) {
      return { ...result, url: target.toString() };
    }

    const location = result.headers.get("location");
    if (!location) {
      return { ...result, url: target.toString() };
    }
    if (remainingRedirects === 0) {
      throw new SafeFetchError("TOO_MANY_REDIRECTS", "Redirect limit exceeded.", {
        status: 502,
        details: { hop, maxRedirects: redirects }
      });
    }

    try {
      target = new URL(location, target);
    } catch (error) {
      throw new SafeFetchError("INVALID_REDIRECT", "Redirect target is invalid.", {
        status: 502,
        details: { hop },
        cause: error
      });
    }
    remainingRedirects -= 1;
    hop += 1;
  }
}
