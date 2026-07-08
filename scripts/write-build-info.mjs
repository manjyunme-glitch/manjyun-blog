import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const unknownCommit = "unknown";
const defaultRepository = "manjyunme-glitch/manjyun-blog";

function cleanCommit(value) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === unknownCommit) return null;
  return trimmed;
}

function readPackedRef(gitDir, refName) {
  const packedRefsPath = join(gitDir, "packed-refs");
  if (!existsSync(packedRefsPath)) return null;

  const rows = readFileSync(packedRefsPath, "utf8").split(/\r?\n/);
  for (const row of rows) {
    if (!row || row.startsWith("#") || row.startsWith("^")) continue;
    const [sha, name] = row.trim().split(/\s+/);
    if (name === refName) return cleanCommit(sha);
  }
  return null;
}

function readGitCommit(rootDir) {
  const gitDir = join(rootDir, ".git");
  const headPath = join(gitDir, "HEAD");
  if (!existsSync(headPath)) return null;

  const head = cleanCommit(readFileSync(headPath, "utf8"));
  if (!head) return null;
  if (/^[0-9a-f]{7,40}$/i.test(head)) return head;

  const match = head.match(/^ref:\s+(.+)$/);
  if (!match) return null;

  const refName = match[1];
  const refPath = join(gitDir, ...refName.split("/"));
  if (existsSync(refPath)) {
    return cleanCommit(readFileSync(refPath, "utf8"));
  }

  return readPackedRef(gitDir, refName);
}

function normalizeRepository(value) {
  const raw = value?.trim() || defaultRepository;
  const match = raw.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/i);
  if (match?.groups) {
    return `${match.groups.owner}/${match.groups.repo}`;
  }
  return raw.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
}

async function withTimeout(promise, timeoutMs, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error("Request timed out"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function readGitHubCommit() {
  const repository = normalizeRepository(
    process.env.GITHUB_REPOSITORY ?? process.env.GITHUB_REPO
  );
  const branch = process.env.GITHUB_BRANCH ?? process.env.GIT_BRANCH ?? "main";
  const controller = new AbortController();
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "manjyun-blog-build-info"
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const response = await withTimeout(
      fetch(
        `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(branch)}`,
        { headers, signal: controller.signal }
      ),
      4500,
      () => controller.abort()
    );
    if (!response.ok) return null;
    const data = await withTimeout(response.json(), 1500);
    return cleanCommit(data?.sha);
  } catch {
    return null;
  }
}

const envCommit = cleanCommit(
  process.env.GIT_COMMIT ??
    process.env.SOURCE_COMMIT ??
    process.env.COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.CF_PAGES_COMMIT_SHA ??
    process.env.RAILWAY_GIT_COMMIT_SHA
);
const gitCommit = readGitCommit(process.cwd());
const githubCommit = envCommit || gitCommit ? null : await readGitHubCommit();
const resolvedCommit = envCommit ?? gitCommit ?? githubCommit ?? unknownCommit;

writeFileSync(
  join(process.cwd(), ".build-info.json"),
  `${JSON.stringify(
    {
      gitCommit: resolvedCommit,
      source: envCommit ? "env" : gitCommit ? "git" : githubCommit ? "github" : "unknown",
      builtAt: new Date().toISOString()
    },
    null,
    2
  )}\n`
);
