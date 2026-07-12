import assert from "node:assert/strict";
import test from "node:test";
import { COMMON_POST_TAGS, hasTag, parseTagInput, toggleTag } from "../src/lib/admin/tags";
import { splitCommaList } from "../src/lib/content/slug";

test("common post tags include the owner's established taxonomy", () => {
  for (const tag of ["碎碎念", "教程", "留档", "私人", "折腾"]) {
    assert.ok(COMMON_POST_TAGS.includes(tag as (typeof COMMON_POST_TAGS)[number]));
  }
  assert.ok(COMMON_POST_TAGS.length > 5);
});

test("tag input accepts Chinese and English separators and removes duplicates", () => {
  assert.deepEqual(
    parseTagInput(" 教程，折腾, tutorial\n教程,TUTORIAL "),
    ["教程", "折腾", "tutorial"]
  );
  assert.deepEqual(splitCommaList("教程，折腾\n留档"), ["教程", "折腾", "留档"]);
});

test("tag shortcuts toggle without losing custom tags", () => {
  const added = toggleTag("自定义, 教程", "折腾");
  assert.equal(added, "自定义, 教程, 折腾");
  assert.equal(hasTag(added, "折腾"), true);

  const removed = toggleTag(added, "教程");
  assert.equal(removed, "自定义, 折腾");
  assert.equal(hasTag(removed, "教程"), false);
});
