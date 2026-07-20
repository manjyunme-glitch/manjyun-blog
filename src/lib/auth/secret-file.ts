import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function createExclusiveSecretFile(
  filePath: string,
  contents: string
) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto
      .randomBytes(8)
      .toString("hex")}.tmp`
  );
  fs.writeFileSync(temporaryPath, contents, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  try {
    try {
      // The hard link publishes a fully-written inode without replacing a
      // winner from another process.
      fs.linkSync(temporaryPath, filePath);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return false;
      if (!["EPERM", "ENOSYS", "EOPNOTSUPP"].includes(code ?? "")) throw error;

      // A few NAS filesystems disable hard links. O_EXCL remains safe against
      // replacement; readers validate the completed value before using it.
      try {
        fs.writeFileSync(filePath, contents, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600
        });
        return true;
      } catch (fallbackError) {
        if ((fallbackError as NodeJS.ErrnoException).code === "EEXIST") {
          const expectedBytes = Buffer.byteLength(contents, "utf8");
          for (let attempt = 0; attempt < 20; attempt += 1) {
            try {
              if (fs.statSync(filePath).size >= expectedBytes) break;
            } catch {
              // The winning process may still be publishing the file.
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
          }
          return false;
        }
        throw fallbackError;
      }
    }
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // A leftover random temporary file contains only an uncommitted secret
      // and is never read by the application.
    }
  }
}
