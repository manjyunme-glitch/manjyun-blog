import fs from "node:fs";
import { createAdminUser } from "@/lib/db/queries";

const barrier = process.env.AUTH_TEST_BARRIER;
const username = process.env.AUTH_TEST_USERNAME;
if (!barrier || !username) {
  throw new Error("AUTH_TEST_BARRIER and AUTH_TEST_USERNAME are required.");
}

fs.writeFileSync(`${barrier}.${username}.ready`, "ready");
const deadline = Date.now() + 5000;
while (!fs.existsSync(barrier)) {
  if (Date.now() >= deadline) throw new Error("Timed out waiting for test barrier.");
  await new Promise((resolve) => setTimeout(resolve, 10));
}

try {
  createAdminUser(
    username,
    "scrypt$test-salt$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
  );
  process.stdout.write("created");
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
