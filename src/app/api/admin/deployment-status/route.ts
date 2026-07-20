import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import {
  classifyDeploymentState,
  hasUpdateAvailable,
  sameCommit,
  type GitHubComparisonStatus
} from "@/lib/deployment/status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const defaultRepository = "manjyunme-glitch/manjyun-blog";
const unknownCommit = "unknown";

type CommitSource = "env" | "build" | "git" | "github" | "portainer" | "unknown";

type CommitInfo = {
  sha: string | null;
  shortSha: string;
  message: string;
  committedAt: string | null;
  url: string | null;
  source: CommitSource;
};

type GitHubCommitResponse = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    committer?: { date?: string };
    author?: { date?: string };
  };
};

type GitHubComparisonResponse = {
  status: GitHubComparisonStatus;
};

type BuildInfo = {
  gitCommit?: string;
  source?: string;
  builtAt?: string;
};

type PortainerStackResponse = {
  GitConfig?: {
    ConfigHash?: string;
    configHash?: string;
  };
};

class TimeoutError extends Error {
  constructor(message = "Request timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

function cleanCommit(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === unknownCommit) return null;
  return trimmed;
}

function shortSha(sha: string | null) {
  return sha ? sha.slice(0, 7) : unknownCommit;
}

function firstLine(value: string | undefined) {
  return value?.split(/\r?\n/)[0]?.trim() || "No commit message";
}

function normalizeRepository(value: string | undefined) {
  const raw = value?.trim() || defaultRepository;
  const match = raw.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/i);
  if (match?.groups) {
    return `${match.groups.owner}/${match.groups.repo}`;
  }
  return raw.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
}

function commitsUrl(repository: string, branch: string) {
  return `https://github.com/${repository}/commits/${encodeURIComponent(branch)}`;
}

async function git(args: string[]) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: process.cwd(),
    timeout: 3500,
    windowsHide: true
  });
  return stdout.trim();
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void
) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new TimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function currentFromGit(): Promise<CommitInfo | null> {
  try {
    const sha = await git(["rev-parse", "HEAD"]);
    const details = await git(["log", "-1", "--format=%s%n%cI", sha]);
    const [message, committedAt] = details.split(/\r?\n/);
    return {
      sha,
      shortSha: shortSha(sha),
      message: firstLine(message),
      committedAt: committedAt?.trim() || null,
      url: null,
      source: "git"
    };
  } catch {
    return null;
  }
}

async function commitInfoFromSha(
  repository: string,
  sha: string,
  source: CommitSource
): Promise<CommitInfo> {
  const githubData = await githubCommit(repository, sha).catch(() => null);
  const resolvedSha = githubData?.sha ?? sha;
  return {
    sha: resolvedSha,
    shortSha: shortSha(resolvedSha),
    message: githubData
      ? firstLine(githubData.commit.message)
      : source === "build"
        ? "Build commit metadata"
        : "No commit message",
    committedAt:
      githubData?.commit.committer?.date ??
      githubData?.commit.author?.date ??
      null,
    url: githubData?.html_url ?? `https://github.com/${repository}/commit/${sha}`,
    source
  };
}

async function currentFromEnv(repository: string): Promise<CommitInfo | null> {
  const sha = cleanCommit(
    process.env.GIT_COMMIT ??
      process.env.SOURCE_COMMIT ??
      process.env.COMMIT_SHA ??
      process.env.PORTAINER_GIT_COMMIT ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.CF_PAGES_COMMIT_SHA ??
      process.env.RAILWAY_GIT_COMMIT_SHA
  );
  if (!sha) return null;

  return commitInfoFromSha(repository, sha, "env");
}

async function currentFromPortainer(repository: string): Promise<CommitInfo | null> {
  const baseUrl = process.env.PORTAINER_URL?.trim();
  const stackId = process.env.PORTAINER_STACK_ID?.trim();
  const apiKey = process.env.PORTAINER_API_KEY?.trim();
  if (!baseUrl || !stackId || !apiKey) return null;

  const controller = new AbortController();
  try {
    const response = await withTimeout(
      fetch(`${baseUrl.replace(/\/+$/, "")}/api/stacks/${encodeURIComponent(stackId)}`, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "X-API-Key": apiKey,
          "User-Agent": "manjyun-blog-deployment-status"
        },
        signal: controller.signal
      }),
      3500,
      () => controller.abort()
    );
    if (!response.ok) return null;
    const data = (await response.json()) as PortainerStackResponse;
    const sha = cleanCommit(data.GitConfig?.ConfigHash ?? data.GitConfig?.configHash);
    return sha ? commitInfoFromSha(repository, sha, "portainer") : null;
  } catch {
    return null;
  }
}

async function currentFromBuildInfo(repository: string): Promise<CommitInfo | null> {
  const candidates = [
    process.env.BUILD_INFO_PATH ? resolve(process.env.BUILD_INFO_PATH) : "",
    join(process.cwd(), ".build-info.json"),
    join(process.cwd(), ".next", "standalone", ".build-info.json")
  ].filter(Boolean);

  for (const filePath of candidates) {
    try {
      const raw = await readFile(filePath, "utf8");
      const data = JSON.parse(raw) as BuildInfo;
      const sha = cleanCommit(data.gitCommit);
      if (!sha) continue;
      return commitInfoFromSha(repository, sha, "build");
    } catch {
      continue;
    }
  }
  return null;
}

async function githubCommit(repository: string, ref: string) {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "manjyun-blog-deployment-status"
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const controller = new AbortController();
  const response = await withTimeout(
    fetch(
      `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`,
      { cache: "no-store", headers, signal: controller.signal }
    ),
    5000,
    () => controller.abort()
  );
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status}`);
  }
  return (await response.json()) as GitHubCommitResponse;
}

async function githubComparison(
  repository: string,
  remoteSha: string,
  currentSha: string
) {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "manjyun-blog-deployment-status"
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const controller = new AbortController();
  const response = await withTimeout(
    fetch(
      `https://api.github.com/repos/${repository}/compare/${encodeURIComponent(remoteSha)}...${encodeURIComponent(currentSha)}`,
      { cache: "no-store", headers, signal: controller.signal }
    ),
    5000,
    () => controller.abort()
  );
  if (!response.ok) {
    throw new Error(`GitHub comparison returned ${response.status}`);
  }
  const data = (await response.json()) as Partial<GitHubComparisonResponse>;
  if (
    data.status !== "identical" &&
    data.status !== "ahead" &&
    data.status !== "behind" &&
    data.status !== "diverged"
  ) {
    throw new Error("GitHub comparison returned an unknown relationship");
  }
  return data.status;
}

function unknownCurrent(): CommitInfo {
  return {
    sha: null,
    shortSha: unknownCommit,
    message: "Build commit metadata missing",
    committedAt: null,
    url: null,
    source: "unknown"
  };
}

export async function GET() {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const repository = normalizeRepository(
    process.env.GITHUB_REPOSITORY ?? process.env.GITHUB_REPO
  );
  const branch = process.env.GITHUB_BRANCH ?? process.env.GIT_BRANCH ?? "main";
  const checkedAt = new Date().toISOString();

  let current =
    (await currentFromEnv(repository)) ??
    (await currentFromPortainer(repository));
  if (!current) {
    current =
      process.env.NODE_ENV === "development"
        ? (await currentFromGit()) ?? (await currentFromBuildInfo(repository))
        : (await currentFromBuildInfo(repository)) ?? (await currentFromGit());
  }
  current ??= unknownCurrent();

  let remote: CommitInfo | null = null;
  let error: string | null = null;
  try {
    const data = await githubCommit(repository, branch);
    remote = {
      sha: data.sha,
      shortSha: shortSha(data.sha),
      message: firstLine(data.commit.message),
      committedAt: data.commit.committer?.date ?? data.commit.author?.date ?? null,
      url: data.html_url,
      source: "github"
    };
  } catch (issue) {
    error = issue instanceof Error ? issue.message : "GitHub check failed";
  }

  let comparisonStatus: GitHubComparisonStatus | null = null;
  if (current.sha && remote?.sha && !sameCommit(current.sha, remote.sha)) {
    try {
      comparisonStatus = await githubComparison(
        repository,
        remote.sha,
        current.sha
      );
    } catch (issue) {
      const comparisonError =
        issue instanceof Error ? issue.message : "GitHub comparison failed";
      error = error ? `${error}; ${comparisonError}` : comparisonError;
    }
  }
  const state = classifyDeploymentState(
    current.sha,
    remote?.sha,
    comparisonStatus
  );

  return NextResponse.json({
    ok: true,
    checkedAt,
    repository,
    branch,
    commitsUrl: commitsUrl(repository, branch),
    state,
    updateAvailable: hasUpdateAvailable(state),
    current,
    remote,
    error
  });
}
