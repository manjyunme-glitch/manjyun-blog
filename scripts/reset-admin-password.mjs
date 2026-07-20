import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

const minimumPasswordLength = 8;
const maximumPasswordBytes = 1024;

function usage() {
  return [
    "Reset the self-hosted administrator password and revoke every session.",
    "",
    "Usage:",
    "  node scripts/reset-admin-password.mjs --generate [--username NAME]",
    "  ADMIN_RESET_PASSWORD='new password' node scripts/reset-admin-password.mjs [--username NAME]",
    "  printf '%s\\n' 'new password' | node scripts/reset-admin-password.mjs --password-stdin [--username NAME]",
    "",
    "Run this command locally or inside the application container. Stop public",
    "traffic first when possible. Passwords are never accepted as command-line arguments."
  ].join("\n");
}

function parseArguments(argv) {
  let generate = false;
  let passwordStdin = false;
  let username = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--generate") {
      generate = true;
    } else if (argument === "--password-stdin") {
      passwordStdin = true;
    } else if (argument === "--username") {
      username = argv[index + 1] ?? null;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}\n\n${usage()}`);
    }
  }
  const sources = [
    generate,
    passwordStdin,
    Boolean(process.env.ADMIN_RESET_PASSWORD)
  ].filter(Boolean).length;
  if (sources !== 1) {
    throw new Error(
      `Choose exactly one password source: --generate, --password-stdin, or ADMIN_RESET_PASSWORD.\n\n${usage()}`
    );
  }
  return { generate, passwordStdin, username: username?.trim() || null };
}

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const password = options.generate
    ? crypto.randomBytes(24).toString("base64url")
    : options.passwordStdin
      ? await readStandardInput()
      : process.env.ADMIN_RESET_PASSWORD;
  const passwordBytes = Buffer.byteLength(password ?? "", "utf8");
  if (
    !password ||
    password.length < minimumPasswordLength ||
    passwordBytes > maximumPasswordBytes
  ) {
    throw new Error(
      `Password must contain at least ${minimumPasswordLength} characters and no more than ${maximumPasswordBytes} bytes.`
    );
  }

  const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data"));
  const databasePath = path.resolve(
    process.env.DATABASE_PATH ?? path.join(dataDir, "manjyun.sqlite")
  );
  if (!fs.existsSync(databasePath)) {
    throw new Error(`Database does not exist: ${databasePath}`);
  }

  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    const adminTable = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_users'"
      )
      .get();
    if (!adminTable) throw new Error("Administrator table does not exist.");

    const columns = database.prepare("PRAGMA table_info(admin_users)").all();
    if (!columns.some((column) => column.name === "session_version")) {
      database.exec(
        "ALTER TABLE admin_users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1"
      );
    }

    const admins = options.username
      ? database
          .prepare("SELECT id, username FROM admin_users WHERE username = ?")
          .all(options.username)
      : database.prepare("SELECT id, username FROM admin_users ORDER BY id").all();
    if (admins.length === 0) {
      throw new Error(
        options.username
          ? `Administrator not found: ${options.username}`
          : "No administrator exists. Use the first-run setup token instead."
      );
    }
    if (!options.username && admins.length !== 1) {
      throw new Error("More than one administrator exists; pass --username NAME.");
    }

    const admin = admins[0];
    const passwordHash = await hashPassword(password);
    database.exec("BEGIN IMMEDIATE;");
    try {
      const result = database
        .prepare(
          `UPDATE admin_users
           SET password_hash = ?, session_version = session_version + 1
           WHERE id = ?`
        )
        .run(passwordHash, admin.id);
      if (result.changes !== 1) throw new Error("Administrator changed during reset.");
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }

    console.log(`Password reset completed for administrator "${admin.username}".`);
    console.log("All previously issued administrator sessions are now invalid.");
    if (options.generate) {
      console.log(`Generated password: ${password}`);
    }
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
