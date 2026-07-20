import assert from "node:assert/strict";
import test from "node:test";
import {
  SETTINGS_DRAFT_MAX_AGE_MS,
  SETTINGS_DRAFT_STORAGE_KEY,
  classifySettingsDraft,
  clearSettingsDraft,
  createSettingsDraftSnapshot,
  handleSettingsHistoryBack,
  readSettingsDraft,
  writeSettingsDraft
} from "@/lib/admin/settings-draft";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

test("settings drafts persist, recover, become stale and clear explicitly", () => {
  const storage = new MemoryStorage();
  const draft = { form: { siteTitle: "Local" }, modules: [{ id: "now" }] };
  const snapshot = createSettingsDraftSnapshot({
    sourceVersion: 4,
    draft,
    savedAt: 1000
  });

  assert.equal(writeSettingsDraft(storage, snapshot), true);
  assert.deepEqual(readSettingsDraft(storage, 1500), snapshot);
  assert.equal(classifySettingsDraft(snapshot, { form: { siteTitle: "Server" }, modules: [] }, 4), "recoverable");
  assert.equal(classifySettingsDraft(snapshot, { form: { siteTitle: "Server" }, modules: [] }, 5), "stale");
  assert.equal(classifySettingsDraft(snapshot, draft, 5), "none");
  assert.equal(clearSettingsDraft(storage), true);
  assert.equal(storage.getItem(SETTINGS_DRAFT_STORAGE_KEY), null);
});

test("expired, future, malformed and storage-failing drafts are ignored safely", () => {
  const storage = new MemoryStorage();
  writeSettingsDraft(storage, createSettingsDraftSnapshot({
    sourceVersion: 1,
    draft: { value: "old" },
    savedAt: 1000
  }));
  assert.equal(
    readSettingsDraft(storage, 1000 + SETTINGS_DRAFT_MAX_AGE_MS + 1),
    null
  );
  assert.equal(storage.getItem(SETTINGS_DRAFT_STORAGE_KEY), null);

  storage.setItem(SETTINGS_DRAFT_STORAGE_KEY, JSON.stringify({
    version: 1,
    savedAt: 100_001,
    sourceVersion: 1,
    draft: {}
  }));
  assert.equal(readSettingsDraft(storage, 1), null);

  storage.setItem(SETTINGS_DRAFT_STORAGE_KEY, "{bad-json");
  assert.equal(readSettingsDraft(storage), null);

  const broken = {
    getItem() { throw new Error("unavailable"); },
    setItem() { throw new Error("unavailable"); },
    removeItem() { throw new Error("unavailable"); }
  };
  const snapshot = createSettingsDraftSnapshot({
    sourceVersion: 1,
    draft: { safe: true }
  });
  assert.equal(writeSettingsDraft(broken, snapshot), false);
  assert.equal(readSettingsDraft(broken), null);
  assert.equal(clearSettingsDraft(broken), false);
});

test("history back guard persists dirty settings and either leaves or restores the guard entry", () => {
  const calls: string[] = [];
  const left = handleSettingsHistoryBack({
    isBaseEntry: true,
    isDirty: true,
    persist: () => calls.push("persist"),
    confirmLeave: () => true,
    allowNavigation: () => calls.push("allow"),
    back: () => calls.push("back"),
    forward: () => calls.push("forward")
  });
  assert.equal(left, "left");
  assert.deepEqual(calls, ["persist", "allow", "back"]);

  calls.length = 0;
  const restored = handleSettingsHistoryBack({
    isBaseEntry: true,
    isDirty: true,
    persist: () => calls.push("persist"),
    confirmLeave: () => false,
    allowNavigation: () => calls.push("allow"),
    back: () => calls.push("back"),
    forward: () => calls.push("forward")
  });
  assert.equal(restored, "restored");
  assert.deepEqual(calls, ["persist", "forward"]);

  calls.length = 0;
  assert.equal(handleSettingsHistoryBack({
    isBaseEntry: false,
    isDirty: true,
    persist: () => calls.push("persist"),
    confirmLeave: () => true,
    allowNavigation: () => calls.push("allow"),
    back: () => calls.push("back"),
    forward: () => calls.push("forward")
  }), "ignored");
  assert.deepEqual(calls, []);
});
