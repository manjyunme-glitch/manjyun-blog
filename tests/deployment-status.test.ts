import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyDeploymentState,
  hasUpdateAvailable,
  sameCommit
} from "@/lib/deployment/status";

const current = "1111111111111111111111111111111111111111";
const remote = "2222222222222222222222222222222222222222";

test("deployment status recognizes identical full and abbreviated SHAs", () => {
  assert.equal(classifyDeploymentState(current, current), "current");
  assert.equal(classifyDeploymentState(current.slice(0, 12), current), "current");
  assert.equal(sameCommit(current, current.slice(0, 7)), true);
});

test("only a deployment behind the remote branch is updateable", () => {
  const behind = classifyDeploymentState(current, remote, "behind");
  const ahead = classifyDeploymentState(current, remote, "ahead");
  const diverged = classifyDeploymentState(current, remote, "diverged");

  assert.equal(behind, "behind");
  assert.equal(ahead, "ahead");
  assert.equal(diverged, "diverged");
  assert.equal(hasUpdateAvailable(behind), true);
  assert.equal(hasUpdateAvailable(ahead), false);
  assert.equal(hasUpdateAvailable(diverged), false);
});

test("deployment status is unknown when ancestry or valid SHAs are unavailable", () => {
  assert.equal(classifyDeploymentState(current, remote), "unknown");
  assert.equal(classifyDeploymentState("unknown", remote, "behind"), "unknown");
  assert.equal(classifyDeploymentState(current, null, "behind"), "unknown");
  assert.equal(classifyDeploymentState("not-a-sha", remote, "behind"), "unknown");
});

test("GitHub identical comparison is handled defensively", () => {
  assert.equal(classifyDeploymentState(current, remote, "identical"), "current");
});
