import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getAdminThemes, resolveAdminTheme } from "@/admin/themes/registry";
import { getThemes } from "@/themes";

test("admin themes map one-to-one to the compiled public themes", () => {
  const adminIds = getAdminThemes().map((theme) => theme.meta.id).sort();
  const publicIds = getThemes().map((theme) => theme.meta.id).sort();
  assert.deepEqual(adminIds, publicIds);
  assert.equal(new Set(adminIds).size, adminIds.length);

  for (const theme of getAdminThemes()) {
    assert.equal(typeof theme.slots.BrandMark, "function");
    assert.equal(typeof theme.slots.ShellDecoration, "function");
    assert.equal(typeof theme.slots.AuthDecoration, "function");
    assert.equal(typeof theme.slots.Preview, "function");
    assert.ok(theme.tokens.background);
    assert.ok(theme.tokens.accent);
  }
});

test("unknown admin themes safely fall back to ManJyun Console", () => {
  const resolved = resolveAdminTheme("future-public-theme");
  assert.equal(resolved.requestedId, "future-public-theme");
  assert.equal(resolved.theme.meta.id, "manjyun-console");
  assert.equal(resolved.isFallback, true);

  const known = resolveAdminTheme("paper-atlas");
  assert.equal(known.theme.meta.id, "paper-atlas");
  assert.equal(known.isFallback, false);
});

test("admin theme definitions stay presentation-only", () => {
  const source = readFileSync(
    new URL("../src/admin/themes/registry.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /lib\/db|api\/admin|fetch\(/);
  assert.doesNotMatch(source, /PostRecord|SiteSettings|MediaRecord/);
});
