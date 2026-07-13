import assert from "node:assert/strict";
import test from "node:test";
import {
  EDITOR_DRAFT_MAX_AGE_MS,
  classifyEditorDraft,
  clearEditorDraft,
  createEditorDraftSnapshot,
  editorDraftStorageKey,
  readEditorDraft,
  writeEditorDraft
} from "@/lib/admin/editor-draft";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

test("editor draft snapshots persist, recover and clear by post id", () => {
  const storage = new MemoryStorage();
  const key = editorDraftStorageKey(42);
  const snapshot = createEditorDraftSnapshot({
    draft: { title: "Local", markdown: "Draft" },
    postId: 42,
    sourceUpdatedAt: "2026-07-13T00:00:00Z",
    savedAt: 1000
  });
  assert.equal(writeEditorDraft(storage, key, snapshot), true);
  assert.deepEqual(readEditorDraft(storage, key, 1500), snapshot);
  assert.equal(classifyEditorDraft(snapshot, { title: "Server", markdown: "Body" }, "2026-07-13T00:00:00Z"), "recoverable");
  assert.equal(clearEditorDraft(storage, key), true);
  assert.equal(readEditorDraft(storage, key, 1500), null);
});

test("editor drafts expire and server changes are classified as stale", () => {
  const storage = new MemoryStorage();
  const key = editorDraftStorageKey(null);
  const snapshot = createEditorDraftSnapshot({
    draft: { title: "Local" },
    sourceUpdatedAt: "old",
    savedAt: 1000
  });
  writeEditorDraft(storage, key, snapshot);
  assert.equal(readEditorDraft(storage, key, 1000 + EDITOR_DRAFT_MAX_AGE_MS + 1), null);
  assert.equal(storage.getItem(key), null);
  assert.equal(classifyEditorDraft(snapshot, { title: "Server" }, "new"), "stale");
  assert.equal(classifyEditorDraft(snapshot, { title: "Local" }, "new"), "none");
});

test("editor draft storage failures do not break the editor", () => {
  const broken = {
    getItem() { throw new Error("unavailable"); },
    setItem() { throw new Error("unavailable"); },
    removeItem() { throw new Error("unavailable"); }
  };
  const snapshot = createEditorDraftSnapshot({ draft: { title: "Safe" } });
  assert.equal(writeEditorDraft(broken, "key", snapshot), false);
  assert.equal(readEditorDraft(broken, "key"), null);
  assert.equal(clearEditorDraft(broken, "key"), false);
});

