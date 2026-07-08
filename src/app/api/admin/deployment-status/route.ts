import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const defaultRepository = "manjyunme-glitch/manjyun-blog";
const unknownCommit = "unknown";

type CommitSource = "env" | "git" | "github" | "unknown";

type CommitInfo = {
  sha: string | null;
  shortSha: string;
  message: string;
  committedAt: string | null;
  url: string | null;
  source: CommitSource;
};

type DeploymentState = "current" | "update-available" | "unknown";

type GitHubCommitResponse = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    committer?: { date?: string };
    author?: { date?: string };
  };
};

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

async function currentFromEnv(repository: string): Promise<CommitInfo | null> {
  const sha = cleanCommit(
    process.env.GIT_COMMIT ??
      process.env.SOURCE_COMMIT ??
      process.env.COMMIT_SHA ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.CF_PAGES_COMMIT_SHA ??
      process.env.RAILWAY_GIT_COMMIT_SHA
  );
  if (!sha) return null;

  const githubData = await githubCommit(repository, sha).catch(() => null);
  return {
    sha: githubData?.sha ?? sha,
    shortSha: shortSha(githubData?.sha ?? sha),
    message: firstLine(githubData?.commit.message),
    committedAt:
      githubData?.commit.committer?.date ??
      githubData?.commit.author?.date ??
      null,
    url: githubData?.html_url ?? `https://github.com/${repository}/commit/${sha}`,
    source: "env"
  };
}

async function githubCommit(repository: string, ref: string) {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "manjyun-blog-deployment-status"
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`,
    { cache: "no-store", headers }
  );
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status}`);
  }
  return (await response.json()) as GitHubCommitResponse;
}

function stateFrom(current: CommitInfo, remote: CommitInfo | null): DeploymentState {
  if (!current.sha || !remote?.sha) return "unknown";
  if (current.sha === remote.sha) return "current";
  if (remote.sha.startsWith(current.sha) || current.sha.startsWith(remote.sha)) {
    return "current";
  }
  return "update-available";
}

function unknownCurrent(): CommitInfo {
  return {
    sha: null,
    shortSha: unknownCommit,
    message: "No build commit found",
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

  const current =
    (await currentFromEnv(repository)) ??
    (await currentFromGit()) ??
    unknownCurrent();

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

  return NextResponse.json({
    ok: true,
    checkedAt,
    repository,
    branch,
    commitsUrl: commitsUrl(repository, branch),
    state: stateFrom(current, remote),
    current,
    remote,
    error
  });
}
