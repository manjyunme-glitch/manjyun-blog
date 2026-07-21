const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  golang: "go",
  js: "javascript",
  md: "markdown",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  yml: "yaml"
};

export function normalizeCodeLanguage(language: string) {
  const raw = language.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  const normalized = CODE_LANGUAGE_ALIASES[raw] ?? raw;
  return normalized
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function inferCodeLanguage(language: string, body: string) {
  const explicit = normalizeCodeLanguage(language);
  if (explicit) return explicit;

  const trimmed = body.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return "json";
  }
  return "";
}
