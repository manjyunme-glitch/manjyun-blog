import fs from "node:fs";
import path from "node:path";

const standaloneDir = path.join(process.cwd(), ".next", "standalone");

const generatedOrSourceOnly = [
  "data",
  "uploads",
  "src",
  "scripts",
  "tests",
  "test-results",
  ".docker-tmp",
  "Dockerfile",
  "docker-compose.yml",
  "README.md",
  "tsconfig.json",
  "tsconfig.tsbuildinfo"
];

if (fs.existsSync(standaloneDir)) {
  for (const entry of generatedOrSourceOnly) {
    fs.rmSync(path.join(standaloneDir, entry), {
      force: true,
      recursive: true
    });
  }
}
