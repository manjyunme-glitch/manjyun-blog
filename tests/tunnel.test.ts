import assert from "node:assert/strict";
import test from "node:test";
import type { TLSSocket } from "node:tls";
import { tunneledHttpsRequestOptions } from "@/lib/net/tunnel";

test("HTTPS tunnel reuses the established TLS socket without an Agent", () => {
  const socket = {} as TLSSocket;
  const options = tunneledHttpsRequestOptions(
    new URL("https://www.google.com/favicon.ico?source=test"),
    { Accept: "image/*" },
    socket,
    5200
  );

  assert.equal(options.agent, undefined);
  assert.equal(options.hostname, "www.google.com");
  assert.equal(options.path, "/favicon.ico?source=test");
  assert.deepEqual(options.headers, {
    Accept: "image/*",
    Host: "www.google.com",
    Connection: "close"
  });
  assert.equal(options.createConnection?.({} as never, () => undefined), socket);
});
