import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createExclusiveSecretFile } from "@/lib/auth/secret-file";
import { getDataDir } from "@/lib/paths";

const minimumSetupTokenBytes = 24;
const maximumSubmittedTokenBytes = 512;

type GlobalSetupToken = typeof globalThis & {
  __manjyunSetupTokenLoggedFor?: string;
};

function configuredToken() {
  const token = process.env.SETUP_TOKEN?.trim();
  if (!token) return null;
  const bytes = Buffer.byteLength(token, "utf8");
  if (
    bytes < minimumSetupTokenBytes ||
    bytes > maximumSubmittedTokenBytes
  ) {
    throw new Error(
      `SETUP_TOKEN must contain between ${minimumSetupTokenBytes} and ${maximumSubmittedTokenBytes} bytes.`
    );
  }
  return token;
}

function tokenPath() {
  return path.join(getDataDir(), "setup-token");
}

function configuredTokenConsumedPath(token: string) {
  const digest = crypto.createHash("sha256").update(token).digest("hex");
  return path.join(getDataDir(), `.setup-token-consumed-${digest}`);
}

function configuredTokenWasConsumed(token: string) {
  return fs.existsSync(configuredTokenConsumedPath(token));
}

function readGeneratedToken(filePath: string) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Setup token path is not a regular file: ${filePath}`);
  }
  const token = fs.readFileSync(filePath, "utf8").trim();
  if (Buffer.byteLength(token, "utf8") < minimumSetupTokenBytes) {
    throw new Error(`Setup token file is invalid: ${filePath}`);
  }
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Some NAS filesystems ignore POSIX modes. The data directory remains the
    // deployment boundary in that case.
  }
  return token;
}

export function ensureSetupToken() {
  const fromEnvironment = configuredToken();
  if (fromEnvironment) {
    if (configuredTokenWasConsumed(fromEnvironment)) {
      throw new Error(
        "SETUP_TOKEN has already been consumed. Rotate it before initializing a new database."
      );
    }
    return fromEnvironment;
  }

  const filePath = tokenPath();
  createExclusiveSecretFile(
    filePath,
    crypto.randomBytes(32).toString("base64url")
  );

  const token = readGeneratedToken(filePath);
  const state = globalThis as GlobalSetupToken;
  if (state.__manjyunSetupTokenLoggedFor !== filePath) {
    console.warn(
      `[ManJyun] First-run setup token: ${token}\n` +
        `[ManJyun] Enter it at /admin/setup. It is also stored at ${filePath} and is removed after setup.`
    );
    state.__manjyunSetupTokenLoggedFor = filePath;
  }
  return token;
}

export function setupTokenMatches(submitted: string) {
  if (
    !submitted ||
    Buffer.byteLength(submitted, "utf8") > maximumSubmittedTokenBytes
  ) {
    return false;
  }
  const expected = ensureSetupToken();
  const submittedDigest = crypto.createHash("sha256").update(submitted).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(submittedDigest, expectedDigest);
}

export function consumeSetupToken() {
  const fromEnvironment = configuredToken();
  if (fromEnvironment) {
    createExclusiveSecretFile(
      configuredTokenConsumedPath(fromEnvironment),
      "consumed\n"
    );
    return;
  }
  const filePath = tokenPath();
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(
        `[ManJyun] Setup completed, but the spent token file could not be removed: ${filePath}`
      );
    }
  }
}

export function removeStaleSetupToken() {
  if (process.env.SETUP_TOKEN?.trim()) {
    consumeSetupToken();
    return;
  }
  const filePath = tokenPath();
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(
        `[ManJyun] Ignoring a stale setup token that could not be removed: ${filePath}`
      );
    }
  }
}

export function resetSetupTokenLogForTests() {
  delete (globalThis as GlobalSetupToken).__manjyunSetupTokenLoggedFor;
}
