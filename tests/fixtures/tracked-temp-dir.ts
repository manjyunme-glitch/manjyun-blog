import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";
import { closeDatabaseForTests } from "@/lib/db/client";

const roots = new Set<string>();
const systemTemp = path.resolve(tmpdir());

export function trackedTempDir(prefix: string) {
  if (!/^manjyun-[a-z0-9-]+-$/i.test(prefix)) {
    throw new Error(`Unsafe test temporary-directory prefix: ${prefix}`);
  }
  const root = path.resolve(mkdtempSync(path.join(systemTemp, prefix)));
  const relative = path.relative(systemTemp, root);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !path.basename(root).startsWith(prefix)
  ) {
    throw new Error(`Refusing to track unexpected test path: ${root}`);
  }
  roots.add(root);
  return root;
}

after(() => {
  closeDatabaseForTests();
  for (const root of roots) {
    const relative = path.relative(systemTemp, root);
    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      !path.basename(root).startsWith("manjyun-")
    ) {
      throw new Error(`Refusing to remove unexpected test path: ${root}`);
    }
    rmSync(root, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 50
    });
  }
  roots.clear();
});
