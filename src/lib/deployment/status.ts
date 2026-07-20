export type GitHubComparisonStatus =
  | "identical"
  | "ahead"
  | "behind"
  | "diverged";

export type DeploymentState =
  | "current"
  | "behind"
  | "ahead"
  | "diverged"
  | "unknown";

function normalizeSha(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{7,64}$/.test(normalized) ? normalized : null;
}

export function sameCommit(
  currentSha: string | null | undefined,
  remoteSha: string | null | undefined
) {
  const current = normalizeSha(currentSha);
  const remote = normalizeSha(remoteSha);
  if (!current || !remote) return false;
  return (
    current === remote ||
    (current.length >= 7 &&
      remote.length >= 7 &&
      (current.startsWith(remote) || remote.startsWith(current)))
  );
}

/**
 * Classify the deployed commit relative to the configured remote branch.
 *
 * GitHub's comparison is requested as `remote...current`, so its status is
 * already expressed from the deployed commit's point of view:
 * - `behind`: the deployed commit can be updated by moving forward to remote;
 * - `ahead`: the deployment contains commits not present on remote;
 * - `diverged`: both sides contain unique commits.
 *
 * A mismatched SHA without a successful ancestry comparison is deliberately
 * `unknown`; SHA inequality alone is not evidence that an update is available.
 */
export function classifyDeploymentState(
  currentSha: string | null | undefined,
  remoteSha: string | null | undefined,
  comparisonStatus?: GitHubComparisonStatus | null
): DeploymentState {
  if (!normalizeSha(currentSha) || !normalizeSha(remoteSha)) return "unknown";
  if (sameCommit(currentSha, remoteSha)) return "current";

  switch (comparisonStatus) {
    case "identical":
      return "current";
    case "behind":
      return "behind";
    case "ahead":
      return "ahead";
    case "diverged":
      return "diverged";
    default:
      return "unknown";
  }
}

export function hasUpdateAvailable(state: DeploymentState) {
  return state === "behind";
}
