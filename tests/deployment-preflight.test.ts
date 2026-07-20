import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.resolve("scripts/validate-deployment-config.mjs");

function makeLayout() {
  const root = mkdtempSync(path.join(os.tmpdir(), "manjyun-preflight-"));
  const dataDir = path.join(root, "data");
  const uploadsDir = path.join(root, "uploads");
  mkdirSync(dataDir);
  mkdirSync(uploadsDir);
  return { root, dataDir, uploadsDir, databasePath: path.join(dataDir, "manjyun.sqlite") };
}

function runPreflight(layout: ReturnType<typeof makeLayout>) {
  return spawnSync(process.execPath, [script], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      STACK_BASE_DIR_HOST: layout.root,
      SITE_URL: "http://127.0.0.1:4482",
      DATA_DIR: layout.dataDir,
      DATABASE_PATH: layout.databasePath,
      UPLOADS_DIR: layout.uploadsDir,
      AUTH_TRUST_PROXY_HOPS: "0",
      SESSION_COOKIE_SECURE: "false",
      AUTH_SECRET: "",
      SETUP_TOKEN: ""
    }
  });
}

test("deployment preflight accepts writable persistent directories and removes probes", () => {
  const layout = makeLayout();
  try {
    const result = runPreflight(layout);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /persistent directories are valid/);
    assert.equal(
      readdirSync(layout.dataDir).some((entry) => entry.startsWith(".manjyun-write-probe-")),
      false
    );
    assert.equal(
      readdirSync(layout.uploadsDir).some((entry) => entry.startsWith(".manjyun-write-probe-")),
      false
    );
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("deployment preflight reports runtime identity and safe ownership guidance", () => {
  const layout = makeLayout();
  rmSync(layout.dataDir, { recursive: true });
  try {
    const result = runPreflight(layout);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DATA_DIR is not writable/);
    assert.match(result.stderr, /container process UID:GID|platform win32/);
    assert.match(result.stderr, /never changes bind-mount ownership automatically/);
    assert.match(result.stderr, /do not use recursive chown|legacy root compatibility mode/);
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("deployment preflight rejects a non-file database path", () => {
  const layout = makeLayout();
  mkdirSync(layout.databasePath);
  try {
    const result = runPreflight(layout);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DATABASE_PATH must point to a regular, non-symbolic-link file/);
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("deployment preflight rejects a symbolic-link database path", (context) => {
  const layout = makeLayout();
  const outsideDatabase = path.join(layout.root, "outside.sqlite");
  writeFileSync(outsideDatabase, "");
  try {
    try {
      symlinkSync(outsideDatabase, layout.databasePath, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip("the current Windows account cannot create symbolic links");
        return;
      }
      throw error;
    }
    const result = runPreflight(layout);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DATABASE_PATH must point to a regular, non-symbolic-link file/);
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("deployment preflight rejects an unsafe persistent authentication secret path", () => {
  const layout = makeLayout();
  mkdirSync(path.join(layout.dataDir, "auth-secret"));
  try {
    const result = runPreflight(layout);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Persistent authentication secret must point to a regular, non-symbolic-link file/
    );
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("deployment preflight rejects a short persistent authentication secret", () => {
  const layout = makeLayout();
  writeFileSync(path.join(layout.dataDir, "auth-secret"), "short\n");
  try {
    const result = runPreflight(layout);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /authentication secret must contain at least 32 UTF-8 bytes/);
    assert.doesNotMatch(result.stderr, /short/);
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("deployment preflight rejects an unusable generated setup token", () => {
  const layout = makeLayout();
  writeFileSync(path.join(layout.dataDir, "setup-token"), "too-short\n");
  try {
    const result = runPreflight(layout);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /setup token must contain between 24 and 512 UTF-8 bytes/);
    assert.doesNotMatch(result.stderr, /too-short/);
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test(
  "deployment preflight fails before startup when an existing SQLite file is read-only",
  { skip: process.platform === "win32" || (typeof process.getuid === "function" && process.getuid() === 0) },
  () => {
    const layout = makeLayout();
    writeFileSync(layout.databasePath, "");
    chmodSync(layout.databasePath, 0o440);
    try {
      const result = runPreflight(layout);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /DATABASE_PATH is not writable/);
      assert.match(result.stderr, /For an existing deployment, keep its explicit BLOG_UID=0/);
    } finally {
      chmodSync(layout.databasePath, 0o600);
      rmSync(layout.root, { recursive: true, force: true });
    }
  }
);
