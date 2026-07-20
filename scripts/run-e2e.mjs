import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const workspace = process.cwd();
const skipBuild = process.argv.slice(2).includes("--skip-build");
const unexpectedArgs = process.argv
  .slice(2)
  .filter((argument) => argument !== "--skip-build");

if (unexpectedArgs.length) {
  throw new Error(`Unknown E2E runner option: ${unexpectedArgs.join(", ")}`);
}

function runNode(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: workspace,
      stdio: "inherit",
      ...options
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Command failed (${signal ? `signal ${signal}` : `exit ${code}`}): node ${args.join(" ")}`
          )
        );
      }
    });
  });
}

async function buildStandalone() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !fs.existsSync(npmCli)) {
    throw new Error(
      "Unable to locate npm. Start the isolated suite with `npm run test:e2e`."
    );
  }
  await runNode([npmCli, "run", "build"]);
}

function getFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a loopback port."));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function copyRuntime(tempRoot) {
  const standalone = path.join(workspace, ".next", "standalone");
  const staticAssets = path.join(workspace, ".next", "static");
  const publicAssets = path.join(workspace, "public");
  const serverEntry = path.join(standalone, "server.js");
  if (!fs.existsSync(serverEntry) || !fs.existsSync(staticAssets)) {
    throw new Error(
      "Production standalone output is missing. Run without --skip-build or execute `npm run build` first."
    );
  }

  const runtime = path.join(tempRoot, "runtime");
  fs.cpSync(standalone, runtime, { recursive: true });
  fs.mkdirSync(path.join(runtime, ".next"), { recursive: true });
  fs.cpSync(staticAssets, path.join(runtime, ".next", "static"), {
    recursive: true
  });
  if (fs.existsSync(publicAssets)) {
    fs.cpSync(publicAssets, path.join(runtime, "public"), { recursive: true });
  }
  return runtime;
}

async function waitForRuntime(baseURL, server) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(
        `Production server exited before becoming ready (${server.signalCode ? `signal ${server.signalCode}` : `exit ${server.exitCode}`}).`
      );
    }
    try {
      const response = await fetch(`${baseURL}/admin/setup`, {
        redirect: "manual",
        signal: AbortSignal.timeout(1_000)
      });
      if (response.status < 500) return;
      lastError = new Error(`Readiness returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the isolated production server.", {
    cause: lastError
  });
}

function waitForExit(child, timeoutMs) {
  if (
    !child ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return Promise.resolve(true);
  }
  return Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
  ]);
}

async function stopServer(server) {
  if (
    !server ||
    server.exitCode !== null ||
    server.signalCode !== null
  ) {
    return;
  }
  server.kill("SIGTERM");
  if (await waitForExit(server, 5_000)) return;
  server.kill("SIGKILL");
  await waitForExit(server, 5_000);
}

function removeTemporaryRoot(tempRoot) {
  const systemTemp = path.resolve(os.tmpdir());
  const resolved = path.resolve(tempRoot);
  const relative = path.relative(systemTemp, resolved);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !path.basename(resolved).startsWith("manjyun-e2e-")
  ) {
    throw new Error(`Refusing to remove unexpected E2E path: ${resolved}`);
  }
  fs.rmSync(resolved, { force: true, recursive: true });
}

let server;
let tempRoot;

try {
  if (!skipBuild) await buildStandalone();

  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "manjyun-e2e-"));
  const dataDir = path.join(tempRoot, "data");
  const uploadsDir = path.join(tempRoot, "uploads");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
  const runtime = copyRuntime(tempRoot);
  const port = await getFreeLoopbackPort();
  const baseURL = `http://127.0.0.1:${port}`;
  const setupToken = `e2e-setup-${crypto.randomBytes(24).toString("base64url")}`;
  const password = `E2E-old-${crypto.randomBytes(18).toString("base64url")}!`;
  const changedPassword = `E2E-new-${crypto.randomBytes(18).toString("base64url")}!`;
  const authSecret = crypto.randomBytes(48).toString("base64url");
  const runtimeEnv = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    DATA_DIR: dataDir,
    DATABASE_PATH: path.join(dataDir, "manjyun.sqlite"),
    UPLOADS_DIR: uploadsDir,
    SITE_URL: baseURL,
    AUTH_SECRET: authSecret,
    SESSION_COOKIE_SECURE: "false",
    AUTH_TRUST_PROXY_HOPS: "0",
    SETUP_TOKEN: setupToken,
    NO_PROXY: "127.0.0.1,localhost,::1",
    no_proxy: "127.0.0.1,localhost,::1"
  };

  console.log(
    `[e2e] Starting isolated production runtime at ${baseURL} with disposable data.`
  );
  server = spawn(process.execPath, ["server.js"], {
    cwd: runtime,
    env: runtimeEnv,
    stdio: "inherit"
  });
  server.once("error", (error) => {
    console.error("[e2e] Production server process error:", error);
  });
  await waitForRuntime(baseURL, server);

  await runNode(
    [
      path.join(workspace, "node_modules", "@playwright", "test", "cli.js"),
      "test",
      "tests/e2e.spec.js",
      "--config=playwright.config.mjs",
      "--output",
      path.join(tempRoot, "test-results"),
      "--reporter=line"
    ],
    {
      env: {
        ...process.env,
        MANJYUN_E2E_BASE_URL: baseURL,
        MANJYUN_E2E_SETUP_TOKEN: setupToken,
        MANJYUN_E2E_USERNAME: "e2e_admin",
        MANJYUN_E2E_PASSWORD: password,
        MANJYUN_E2E_CHANGED_PASSWORD: changedPassword,
        NO_PROXY: "127.0.0.1,localhost,::1",
        no_proxy: "127.0.0.1,localhost,::1"
      }
    }
  );
} finally {
  await stopServer(server);
  if (tempRoot) removeTemporaryRoot(tempRoot);
}
