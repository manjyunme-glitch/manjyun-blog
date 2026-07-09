import assert from "node:assert/strict";
import test from "node:test";
import { proxyForUrl, shouldBypassProxy } from "@/lib/net/proxy";

test("proxy selection reads stack-prefixed variables", () => {
  const environment = {
    STACK_HTTP_PROXY: "http://192.168.0.113:7890",
    STACK_HTTPS_PROXY: "http://192.168.0.113:7890"
  };

  assert.equal(
    proxyForUrl(new URL("https://www.google.com"), environment)?.toString(),
    "http://192.168.0.113:7890/"
  );
  assert.equal(
    proxyForUrl(new URL("http://example.com"), environment)?.toString(),
    "http://192.168.0.113:7890/"
  );
});

test("no-proxy supports local hosts, domain suffixes, ports, and IPv4 CIDR", () => {
  const environment = {
    STACK_NO_PROXY:
      "localhost,127.0.0.1,::1,.internal.example,service.test:8443,192.168.0.0/16,10.0.0.0/8"
  };

  assert.equal(shouldBypassProxy(new URL("http://localhost:3000"), environment), true);
  assert.equal(shouldBypassProxy(new URL("http://192.168.20.4"), environment), true);
  assert.equal(shouldBypassProxy(new URL("http://10.24.0.8"), environment), true);
  assert.equal(shouldBypassProxy(new URL("https://api.internal.example"), environment), true);
  assert.equal(shouldBypassProxy(new URL("https://service.test:8443"), environment), true);
  assert.equal(shouldBypassProxy(new URL("https://service.test"), environment), false);
  assert.equal(shouldBypassProxy(new URL("https://www.google.com"), environment), false);
});

test("no-proxy prevents proxy selection for private network targets", () => {
  const environment = {
    STACK_HTTPS_PROXY: "http://192.168.0.113:7890",
    STACK_NO_PROXY: "192.168.0.0/16"
  };

  assert.equal(proxyForUrl(new URL("https://192.168.1.10"), environment), null);
});
