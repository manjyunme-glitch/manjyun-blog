"use client";

import { useState } from "react";
import { formatDateTime as formatBeijingDateTime } from "@/lib/content/format";

type CommitInfo = {
  sha: string | null;
  shortSha: string;
  message: string;
  committedAt: string | null;
  url: string | null;
  source: "env" | "build" | "git" | "github" | "portainer" | "unknown";
};

type DeploymentStatus = {
  ok: true;
  checkedAt: string;
  repository: string;
  branch: string;
  commitsUrl: string;
  state: "current" | "update-available" | "unknown";
  current: CommitInfo;
  remote: CommitInfo | null;
  error: string | null;
};

type ApiError = {
  ok: false;
  error: string;
};

const initialCurrent: CommitInfo = {
  sha: null,
  shortSha: "unknown",
  message: "点击检查后读取当前部署版本",
  committedAt: null,
  url: null,
  source: "unknown"
};

function formatCommitDateTime(input: string | null) {
  return input ? formatBeijingDateTime(input) : "时间未知";
}

function stateLabel(status: DeploymentStatus | null, pending: boolean, error: string) {
  if (pending) return "检查中";
  if (error) return "检查失败";
  if (!status) return "未检查";
  if (status.state === "current") return "已同步";
  if (status.state === "update-available") return "可更新";
  return "无法判断";
}

function stateClass(status: DeploymentStatus | null, pending: boolean, error: string) {
  if (pending || error || !status || status.state === "unknown") return "";
  if (status.state === "current") return "published";
  return "needs-update";
}

function sourceLabel(source: CommitInfo["source"]) {
  const labels: Record<CommitInfo["source"], string> = {
    env: "env",
    build: "build metadata",
    git: "local git",
    github: "GitHub",
    portainer: "Portainer",
    unknown: "unknown"
  };
  return labels[source];
}

function VersionCard({
  label,
  commit
}: {
  label: string;
  commit: CommitInfo | null;
}) {
  const data = commit ?? {
    ...initialCurrent,
    message: "检查失败或远端不可用"
  };

  return (
    <div className="deployment-version-card">
      <span>{label}</span>
      {data.url ? (
        <a href={data.url} target="_blank" rel="noreferrer">
          {data.shortSha}
        </a>
      ) : (
        <strong>{data.shortSha}</strong>
      )}
      <p>{data.message}</p>
      <small>
        {formatCommitDateTime(data.committedAt)} · {sourceLabel(data.source)}
      </small>
    </div>
  );
}

export function DeploymentStatusCard() {
  const [status, setStatus] = useState<DeploymentStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function checkStatus() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin/deployment-status", {
        cache: "no-store"
      });
      const data = (await response.json().catch(() => null)) as
        | DeploymentStatus
        | ApiError
        | null;
      if (!response.ok || !data?.ok) {
        setError(data && !data.ok ? data.error : "检查失败");
        return;
      }
      setStatus(data);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "检查失败");
    } finally {
      setPending(false);
    }
  }

  const current = status?.current ?? initialCurrent;
  const remote = status?.remote ?? null;

  return (
    <section className="admin-panel deployment-card">
      <header className="deployment-head">
        <div>
          <span className="deployment-kicker">Deployment Status</span>
          <h2>检查 GitHub 更新</h2>
          <p>比较当前 Docker 构建与 GitHub 主分支，只显示状态，不会自动操作 Portainer。</p>
        </div>
        <div className="deployment-actions">
          <span className={`status-pill ${stateClass(status, pending, error)}`}>
            {stateLabel(status, pending, error)}
          </span>
          <button className="btn primary" type="button" disabled={pending} onClick={() => void checkStatus()}>
            ↻ 检查更新
          </button>
        </div>
      </header>

      <div className="deployment-versions">
        <VersionCard label="当前部署" commit={current} />
        <VersionCard label={status ? `GitHub ${status.branch}` : "GitHub main"} commit={remote} />
      </div>

      {error || status?.error ? (
        <p className="deployment-error">{error || status?.error}</p>
      ) : null}

      <footer className="deployment-footer">
        <span>检查时间: {status ? formatBeijingDateTime(status.checkedAt) : "尚未检查"}</span>
        <a href={status?.commitsUrl ?? "https://github.com/manjyunme-glitch/manjyun-blog/commits/main"} target="_blank" rel="noreferrer">
          查看提交记录
        </a>
      </footer>
    </section>
  );
}
