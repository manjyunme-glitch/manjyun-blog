import type { RequestOptions } from "node:https";
import type { TLSSocket } from "node:tls";

export function tunneledHttpsRequestOptions(
  target: URL,
  headers: Record<string, string>,
  secureSocket: TLSSocket,
  timeoutMs: number
): RequestOptions {
  // Node only honors this request-level createConnection when no Agent is supplied.
  return {
    protocol: "https:",
    hostname: target.hostname,
    port: target.port || 443,
    path: `${target.pathname}${target.search}`,
    method: "GET",
    headers: {
      ...headers,
      Host: target.host,
      Connection: "close"
    },
    createConnection: () => secureSocket,
    timeout: timeoutMs
  };
}
