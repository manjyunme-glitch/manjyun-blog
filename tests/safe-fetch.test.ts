import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  directRequestOptions,
  fetchUrlSafely,
  httpProxyRequestOptions,
  isPublicIpAddress,
  pinnedConnectAuthority,
  pinnedHttpProxyPath,
  proxyConnectRequestOptions,
  resolvePublicTarget,
  SafeFetchError,
  tunneledTlsOptions,
  type FetchResult,
  type LookupAll,
  type ResolvedTarget
} from "@/lib/net/safe-fetch";

function hasErrorCode(code: SafeFetchError["code"]) {
  return (error: unknown) => error instanceof SafeFetchError && error.code === code;
}

function result(status: number, location?: string): FetchResult {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "",
    headers: new Map(location ? [["location", location]] : []),
    body: Buffer.alloc(0)
  };
}

const fetchOptions = {
  accept: "image/*",
  timeoutMs: 1000,
  maxBytes: 1024
};

test("public address policy rejects non-global IPv4 and IPv6 ranges", () => {
  const blocked = [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::7f00:1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "2002:7f00:1::1",
    "3fff::1"
  ];

  for (const address of blocked) {
    assert.equal(isPublicIpAddress(address), false, address);
  }

  for (const address of [
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808"
  ]) {
    assert.equal(isPublicIpAddress(address), true, address);
  }
});

test("WHATWG-normalized non-canonical IPv4 forms cannot bypass literal checks", async () => {
  const inputs = [
    "http://127.1",
    "http://0177.0.0.1",
    "http://0x7f000001",
    "http://2130706433",
    "http://017700000001",
    "http://[::ffff:127.0.0.1]"
  ];
  let lookupCalls = 0;
  const lookup: LookupAll = async () => {
    lookupCalls += 1;
    return [{ address: "93.184.216.34", family: 4 }];
  };

  for (const input of inputs) {
    await assert.rejects(
      resolvePublicTarget(new URL(input), lookup),
      hasErrorCode("TARGET_NOT_PUBLIC"),
      input
    );
  }
  assert.equal(lookupCalls, 0);
});

test("DNS validation rejects a hostname if any answer is non-public", async () => {
  let seenOptions: unknown;
  const lookup: LookupAll = async (_hostname, options) => {
    seenOptions = options;
    return [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 }
    ];
  };

  await assert.rejects(
    resolvePublicTarget(new URL("https://mixed.example/favicon.ico"), lookup),
    hasErrorCode("TARGET_NOT_PUBLIC")
  );
  assert.deepEqual(seenOptions, { all: true, verbatim: true });
});

test("DNS failures are structured and never fall back to the hostname", async () => {
  const lookup: LookupAll = async () => {
    throw new Error("controlled resolver failure");
  };
  let transportCalls = 0;

  await assert.rejects(
    fetchUrlSafely("https://unresolved.example/favicon.ico", fetchOptions, {
      lookup,
      proxySelector: () => null,
      transport: async () => {
        transportCalls += 1;
        return result(200);
      }
    }),
    hasErrorCode("DNS_RESOLUTION_FAILED")
  );
  assert.equal(transportCalls, 0);
});

test("validated DNS addresses are tried in order until one connects", async () => {
  const attempted: string[] = [];
  const response = await fetchUrlSafely(
    "https://dual-stack.example/favicon.ico",
    fetchOptions,
    {
      lookup: async () => [
        { address: "2001:4860:4860::8888", family: 6 },
        { address: "93.184.216.34", family: 4 }
      ],
      proxySelector: () => null,
      transport: async (_target, resolved) => {
        attempted.push(resolved.address);
        if (resolved.family === 6) throw new Error("IPv6 is unavailable");
        return result(200);
      }
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(attempted, [
    "2001:4860:4860::8888",
    "93.184.216.34"
  ]);
});

test("DNS resolution and all redirect hops share the request deadline", async () => {
  await assert.rejects(
    fetchUrlSafely(
      "https://slow-dns.example/favicon.ico",
      { ...fetchOptions, timeoutMs: 20 },
      {
        lookup: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return [{ address: "93.184.216.34", family: 4 }];
        },
        proxySelector: () => null,
        transport: async () => result(200)
      }
    ),
    hasErrorCode("REQUEST_TIMEOUT")
  );
});

test("direct and proxy request targets are pinned to the validated address", () => {
  const target = new URL("https://origin.example:8443/favicon.ico?source=test");
  const resolved: ResolvedTarget = { address: "93.184.216.34", family: 4 };
  const proxy = new URL("http://192.168.1.20:7890");
  const options = directRequestOptions(target, resolved, { Accept: "image/*" }, 5200);

  assert.equal(options.hostname, "93.184.216.34");
  assert.equal(options.family, 4);
  assert.equal(options.servername, "origin.example");
  assert.equal(options.path, "/favicon.ico?source=test");
  assert.deepEqual(options.headers, {
    Accept: "image/*",
    Host: "origin.example:8443",
    Connection: "close"
  });
  assert.equal(
    pinnedHttpProxyPath(
      new URL("http://origin.example:8080/favicon.ico?source=test"),
      resolved
    ),
    "http://93.184.216.34:8080/favicon.ico?source=test"
  );
  assert.equal(pinnedConnectAuthority(target, resolved), "93.184.216.34:8443");
  assert.equal(
    pinnedConnectAuthority(
      new URL("https://origin.example/favicon.ico"),
      { address: "2001:4860:4860::8888", family: 6 }
    ),
    "[2001:4860:4860::8888]:443"
  );

  const httpProxyOptions = httpProxyRequestOptions(
    new URL("http://origin.example:8080/favicon.ico?source=test"),
    resolved,
    proxy,
    { Accept: "image/*" },
    5200
  );
  assert.equal(
    httpProxyOptions.path,
    "http://93.184.216.34:8080/favicon.ico?source=test"
  );
  assert.deepEqual(httpProxyOptions.headers, {
    Accept: "image/*",
    Host: "origin.example:8080",
    Connection: "close"
  });

  const connectOptions = proxyConnectRequestOptions(
    target,
    resolved,
    proxy,
    5200
  );
  assert.equal(connectOptions.path, "93.184.216.34:8443");
  assert.deepEqual(connectOptions.headers, {
    Host: "93.184.216.34:8443"
  });

  const tlsOptions = tunneledTlsOptions(target, {} as never);
  assert.equal(tlsOptions.servername, "origin.example");
  assert.equal(typeof tlsOptions.checkServerIdentity, "function");
});

test("every redirect hop is resolved, validated, and passed to transport as a snapshot", async () => {
  const lookups: string[] = [];
  const requests: Array<{
    hostname: string;
    address: string;
    proxy: string | null;
  }> = [];
  const lookup: LookupAll = async (hostname) => {
    lookups.push(hostname);
    return hostname === "start.example"
      ? [{ address: "93.184.216.34", family: 4 }]
      : [{ address: "8.8.8.8", family: 4 }];
  };

  const response = await fetchUrlSafely(
    "http://start.example/page",
    fetchOptions,
    {
      lookup,
      proxySelector: () => new URL("http://192.168.1.20:7890"),
      transport: async (target, resolved, proxy) => {
        requests.push({
          hostname: target.hostname,
          address: resolved.address,
          proxy: proxy?.toString() ?? null
        });
        return target.hostname === "start.example"
          ? result(302, "https://cdn.example/favicon.ico")
          : result(200);
      }
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.url, "https://cdn.example/favicon.ico");
  assert.deepEqual(lookups, ["start.example", "cdn.example"]);
  assert.deepEqual(requests, [
    {
      hostname: "start.example",
      address: "93.184.216.34",
      proxy: "http://192.168.1.20:7890/"
    },
    {
      hostname: "cdn.example",
      address: "8.8.8.8",
      proxy: "http://192.168.1.20:7890/"
    }
  ]);
});

test("a redirect to a private DNS answer is blocked before the second request", async () => {
  let transportCalls = 0;
  const lookup: LookupAll = async (hostname) =>
    hostname === "public.example"
      ? [{ address: "93.184.216.34", family: 4 }]
      : [{ address: "169.254.169.254", family: 4 }];

  await assert.rejects(
    fetchUrlSafely("https://public.example/page", fetchOptions, {
      lookup,
      proxySelector: () => new URL("http://192.168.1.20:7890"),
      transport: async () => {
        transportCalls += 1;
        return result(302, "http://metadata.example/latest/meta-data");
      }
    }),
    hasErrorCode("TARGET_NOT_PUBLIC")
  );
  assert.equal(transportCalls, 1);
});

test("redirect limits and non-HTTP redirect schemes return structured errors", async () => {
  const lookup: LookupAll = async () => [
    { address: "93.184.216.34", family: 4 }
  ];

  await assert.rejects(
    fetchUrlSafely(
      "https://public.example/start",
      { ...fetchOptions, redirects: 0 },
      {
        lookup,
        proxySelector: () => null,
        transport: async () => result(302, "/again")
      }
    ),
    hasErrorCode("TOO_MANY_REDIRECTS")
  );

  await assert.rejects(
    fetchUrlSafely("https://public.example/start", fetchOptions, {
      lookup,
      proxySelector: () => null,
      transport: async () => result(302, "file:///etc/passwd")
    }),
    hasErrorCode("UNSUPPORTED_PROTOCOL")
  );
});

test("HTTPS proxy TLS handshakes cannot remain pending past the timeout", async () => {
  const sockets = new Set<import("node:net").Socket>();
  const proxy = http.createServer();
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  proxy.on("connect", (_request, socket) => {
    // Accept CONNECT but never complete the TLS handshake.
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));

  try {
    const address = proxy.address();
    assert.ok(address && typeof address === "object");
    const startedAt = Date.now();
    await assert.rejects(
      fetchUrlSafely(
        "https://public.example/favicon.ico",
        { ...fetchOptions, timeoutMs: 100 },
        {
          lookup: async () => [{ address: "93.184.216.34", family: 4 }],
          proxySelector: () =>
            new URL(`http://127.0.0.1:${address.port}`)
        }
      ),
      hasErrorCode("REQUEST_TIMEOUT")
    );
    assert.ok(
      Date.now() - startedAt < 1_500,
      "stalled TLS handshake exceeded its bounded timeout"
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      proxy.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("response body trickle cannot extend the overall request deadline", async () => {
  const sockets = new Set<import("node:net").Socket>();
  const proxy = http.createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": "10",
      Connection: "close"
    });
    response.flushHeaders();
    let written = 0;
    const interval = setInterval(() => {
      if (written >= 10) {
        clearInterval(interval);
        response.end();
        return;
      }
      response.write(Buffer.from([written]));
      written += 1;
    }, 30);
    response.on("close", () => clearInterval(interval));
  });
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));

  try {
    const address = proxy.address();
    assert.ok(address && typeof address === "object");
    const startedAt = Date.now();
    await assert.rejects(
      fetchUrlSafely(
        "http://public.example/favicon.ico",
        { ...fetchOptions, timeoutMs: 120 },
        {
          lookup: async () => [{ address: "93.184.216.34", family: 4 }],
          proxySelector: () =>
            new URL(`http://127.0.0.1:${address.port}`)
        }
      ),
      hasErrorCode("REQUEST_TIMEOUT")
    );
    assert.ok(
      Date.now() - startedAt < 1_000,
      "slow response body exceeded its bounded total deadline"
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      proxy.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
