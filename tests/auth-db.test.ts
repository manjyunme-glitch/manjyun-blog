import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { ensureSchema } from "@/lib/db/schema";
import { trackedTempDir } from "./fixtures/tracked-temp-dir";

type ChildResult = {
  code: number | null;
  stderr: string;
  stdout: string;
};

function waitForChild(child: ReturnType<typeof spawn>) {
  return new Promise<ChildResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr, stdout }));
  });
}

async function waitForFiles(paths: string[]) {
  const deadline = Date.now() + 5000;
  while (!paths.every((filePath) => fs.existsSync(filePath))) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for setup racers.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("first-run administrator creation is atomic across processes", async () => {
  const root = trackedTempDir("manjyun-setup-race-");
  const databasePath = path.join(root, "manjyun.sqlite");
  const database = new DatabaseSync(databasePath);
  ensureSchema(database);
  database.close();

  const barrier = path.join(root, "start");
  const fixture = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "create-admin-racer.ts"
  );
  const tsxCli = path.join(
    process.cwd(),
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs"
  );
  const environment = {
    ...process.env,
    AUTH_SECRET: "",
    DATA_DIR: root,
    DATABASE_PATH: databasePath,
    SETUP_TOKEN: "",
    AUTH_TEST_BARRIER: barrier
  };
  const first = spawn(process.execPath, [tsxCli, fixture], {
    cwd: process.cwd(),
    env: { ...environment, AUTH_TEST_USERNAME: "first-admin" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const second = spawn(process.execPath, [tsxCli, fixture], {
    cwd: process.cwd(),
    env: { ...environment, AUTH_TEST_USERNAME: "second-admin" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const firstResult = waitForChild(first);
  const secondResult = waitForChild(second);
  await waitForFiles([
    `${barrier}.first-admin.ready`,
    `${barrier}.second-admin.ready`
  ]);
  fs.writeFileSync(barrier, "go");
  const results = await Promise.all([firstResult, secondResult]);

  assert.deepEqual(
    results.map((result) => result.code).sort(),
    [0, 2]
  );
  assert.equal(
    results.filter((result) => result.stdout.includes("created")).length,
    1
  );
  assert.ok(
    Buffer.byteLength(
      fs.readFileSync(path.join(root, "auth-secret"), "utf8").trim(),
      "utf8"
    ) >= 32
  );
  const setupTokenPath = path.join(root, "setup-token");
  if (fs.existsSync(setupTokenPath)) {
    assert.ok(
      Buffer.byteLength(fs.readFileSync(setupTokenPath, "utf8").trim(), "utf8") >=
        24
    );
  }

  const check = new DatabaseSync(databasePath);
  assert.equal(
    (check.prepare("SELECT COUNT(*) AS count FROM admin_users").get() as {
      count: number;
    }).count,
    1
  );
  check.close();
});

test("password changes and offline resets increment the session version", async () => {
  const root = trackedTempDir("manjyun-password-reset-");
  const previousDataDir = process.env.DATA_DIR;
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSecret = process.env.AUTH_SECRET;
  const previousSetupToken = process.env.SETUP_TOKEN;
  const databasePath = path.join(root, "manjyun.sqlite");
  try {
    process.env.DATA_DIR = root;
    process.env.DATABASE_PATH = databasePath;
    process.env.AUTH_SECRET = "a".repeat(32);
    process.env.SETUP_TOKEN = "t".repeat(24);

    const queries = await import("@/lib/db/queries");
    const originalHash = await hashPassword("old-password");
    const admin = queries.createAdminUser("admin", originalHash);
    assert.equal(admin.sessionVersion, 1);

    const replacementHash = await hashPassword("new-password");
    const changed = queries.changeAdminPassword(
      admin.id,
      originalHash,
      replacementHash
    );
    assert.equal(changed?.sessionVersion, 2);
    assert.equal(
      queries.changeAdminPassword(admin.id, originalHash, originalHash),
      null
    );
    assert.equal(
      await verifyPassword(
        "new-password",
        queries.getAdminByUsername("admin")!.passwordHash
      ),
      true
    );

    assert.equal(queries.revokeAdminSessions(admin.id)?.sessionVersion, 3);

    const reset = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "scripts", "reset-admin-password.mjs")],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ADMIN_RESET_PASSWORD: "offline-password"
        }
      }
    );
    assert.equal(reset.status, 0, reset.stderr);
    assert.match(reset.stdout, /All previously issued administrator sessions are now invalid/);
    const afterReset = queries.getAdminByUsername("admin")!;
    assert.equal(afterReset.sessionVersion, 4);
    assert.equal(
      await verifyPassword("offline-password", afterReset.passwordHash),
      true
    );
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
    if (previousSetupToken === undefined) delete process.env.SETUP_TOKEN;
    else process.env.SETUP_TOKEN = previousSetupToken;
  }
});
