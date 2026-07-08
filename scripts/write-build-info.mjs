import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const unknownCommit = "unknown";

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

const envCommit = cleanCommit(
  process.env.GIT_COMMIT ??
    process.env.SOURCE_COMMIT ??
    process.env.COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.CF_PAGES_COMMIT_SHA ??
    process.env.RAILWAY_GIT_COMMIT_SHA
);
const gitCommit = readGitCommit(process.cwd());
const resolvedCommit = envCommit ?? gitCommit ?? unknownCommit;

writeFileSync(
  join(process.cwd(), ".build-info.json"),
  `${JSON.stringify(
    {
      gitCommit: resolvedCommit,
      source: envCommit ? "env" : gitCommit ? "git" : "unknown",
      builtAt: new Date().toISOString()
    },
    null,
    2
  )}\n`
);
