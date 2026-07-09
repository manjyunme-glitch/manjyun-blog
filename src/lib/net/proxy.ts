type ProxyEnvironment = Record<string, string | undefined>;

function firstDefined(environment: ProxyEnvironment, names: string[]) {
  for (const name of names) {
    const value = environment[name];
    if (value !== undefined) return value.trim();
  }
  return "";
}

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function ipv4ToNumber(input: string) {
  const octets = input.split(".");
  if (octets.length !== 4) return null;

  let value = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    const number = Number(octet);
    if (number > 255) return null;
    value = (value * 256 + number) >>> 0;
  }
  return value;
}

function matchesIpv4Cidr(hostname: string, rule: string) {
  const [networkInput, prefixInput, ...rest] = rule.split("/");
  if (rest.length || prefixInput === undefined || !/^\d{1,2}$/.test(prefixInput)) {
    return false;
  }

  const host = ipv4ToNumber(hostname);
  const network = ipv4ToNumber(networkInput);
  const prefix = Number(prefixInput);
  if (host === null || network === null || prefix < 0 || prefix > 32) return false;

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (host & mask) === (network & mask);
}

function splitRulePort(rule: string) {
  const bracketed = rule.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketed) {
    return { hostname: bracketed[1], port: bracketed[2] ?? "" };
  }

  const colonCount = (rule.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    const match = rule.match(/^(.+):(\d+)$/);
    if (match) return { hostname: match[1], port: match[2] };
  }
  return { hostname: rule, port: "" };
}

export function shouldBypassProxy(
  target: URL,
  environment: ProxyEnvironment = process.env
) {
  const noProxy = firstDefined(environment, ["STACK_NO_PROXY", "NO_PROXY", "no_proxy"]);
  if (!noProxy) return false;

  const hostname = normalizeHostname(target.hostname);
  const targetPort = target.port || (target.protocol === "https:" ? "443" : "80");

  return noProxy
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") return true;
      if (entry.includes("/") && matchesIpv4Cidr(hostname, entry)) return true;

      const { hostname: ruleInput, port } = splitRulePort(entry);
      if (port && port !== targetPort) return false;

      const rule = normalizeHostname(ruleInput).replace(/^\*\./, ".").replace(/\.$/, "");
      if (!rule) return false;
      if (rule.startsWith(".")) {
        const suffix = rule.slice(1);
        return hostname === suffix || hostname.endsWith(rule);
      }
      return hostname === rule || hostname.endsWith(`.${rule}`);
    });
}

export function proxyForUrl(
  target: URL,
  environment: ProxyEnvironment = process.env
) {
  if (shouldBypassProxy(target, environment)) return null;

  const names =
    target.protocol === "https:"
      ? [
          "STACK_HTTPS_PROXY",
          "HTTPS_PROXY",
          "https_proxy",
          "STACK_HTTP_PROXY",
          "HTTP_PROXY",
          "http_proxy",
          "ALL_PROXY",
          "all_proxy"
        ]
      : [
          "STACK_HTTP_PROXY",
          "HTTP_PROXY",
          "http_proxy",
          "ALL_PROXY",
          "all_proxy"
        ];
  const proxy = firstDefined(environment, names);
  if (!proxy) return null;

  try {
    const url = new URL(proxy);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
