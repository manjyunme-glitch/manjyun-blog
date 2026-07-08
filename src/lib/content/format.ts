const BEIJING_TIME_ZONE = "Asia/Shanghai";

function parseStoredDate(input: string) {
  const normalized = input.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(normalized)) {
    return new Date(`${normalized.replace(" ", "T")}Z`);
  }
  return new Date(normalized);
}

export function formatDate(input: string | null | undefined) {
  if (!input) return "draft";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .format(parseStoredDate(input))
    .replaceAll("/", "-");
}

export function formatDateTime(input: string | null | undefined) {
  if (!input) return "draft";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })
    .format(parseStoredDate(input))
    .replaceAll("/", "-");
}

export function hostFromUrl(url: string) {
  try {
    return new URL(url, "http://localhost").hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function uptimeFrom(start: string) {
  const startTime = new Date(`${start}T00:00:00+08:00`).getTime();
  if (Number.isNaN(startTime)) return "0d 0h";
  const diff = Math.max(Date.now() - startTime, 0);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  return `${days}d ${hours}h`;
}
