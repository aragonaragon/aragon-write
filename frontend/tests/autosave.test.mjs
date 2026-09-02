import test from "node:test";
import assert from "node:assert/strict";
import {
  clearProjectDraftIfCurrent,
  mergeProjectDrafts,
  readProjectDrafts,
  saveProjectDraft,
} from "../src/lib/autosave.js";

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function doc(overrides = {}) {
  return {
    id: "chapter-1",
    title: "الفصل الأول",
    content: "<p>نسخة القرص</p>",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

test("restores a newer local draft over the disk copy", () => {
  const storage = memoryStorage();
  const draft = doc({ content: "<p>آخر كتابة</p>", updatedAt: "2026-01-01T00:00:02.000Z" });
  assert.equal(saveProjectDraft("novel", draft, storage), true);

  const result = mergeProjectDrafts("novel", [doc()], storage);

  assert.equal(result.documents[0].content, "<p>آخر كتابة</p>");
  assert.deepEqual(result.recovered.map((item) => item.id), ["chapter-1"]);
});

test("recovers a draft whose document was never written to disk", () => {
  const storage = memoryStorage();
  const draft = doc({ id: "new-chapter", content: "<p>مسودة جديدة</p>" });
  saveProjectDraft("novel", draft, storage);

  const result = mergeProjectDrafts("novel", [], storage);

  assert.equal(result.documents[0].id, "new-chapter");
  assert.equal(result.recovered.length, 1);
});

test("keeps a newer disk copy and marks the old draft as stale", () => {
  const storage = memoryStorage();
  saveProjectDraft("novel", doc(), storage);
  const saved = doc({ content: "<p>نسخة أحدث</p>", updatedAt: "2026-01-01T00:00:03.000Z" });

  const result = mergeProjectDrafts("novel", [saved], storage);

  assert.equal(result.documents[0].content, "<p>نسخة أحدث</p>");
  assert.deepEqual(result.stale, ["chapter-1"]);
});

test("does not clear a newer draft after an older save finishes", () => {
  const storage = memoryStorage();
  const older = doc({ content: "<p>قديم</p>", updatedAt: "2026-01-01T00:00:02.000Z" });
  const newer = doc({ content: "<p>جديد</p>", updatedAt: "2026-01-01T00:00:03.000Z" });
  saveProjectDraft("novel", newer, storage);

  assert.equal(clearProjectDraftIfCurrent("novel", older, storage), false);
  assert.equal(readProjectDrafts("novel", storage)[0].content, "<p>جديد</p>");
  assert.equal(clearProjectDraftIfCurrent("novel", newer, storage), true);
  assert.equal(readProjectDrafts("novel", storage).length, 0);
});
