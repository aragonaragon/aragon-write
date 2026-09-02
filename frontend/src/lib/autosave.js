const PROJECT_DRAFT_PREFIX = "aragon-write-project-draft-v1:";

function getStorage(storage) {
  return storage || globalThis.localStorage;
}

function draftKey(projectId, docId) {
  return `${PROJECT_DRAFT_PREFIX}${projectId}:${docId}`;
}

function parseDraft(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.projectId || !parsed?.doc?.id || typeof parsed.doc.content !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function saveProjectDraft(projectId, doc, storage) {
  if (!projectId || !doc?.id || typeof doc.content !== "string") return false;
  try {
    getStorage(storage).setItem(
      draftKey(projectId, doc.id),
      JSON.stringify({ projectId, doc, savedAt: new Date().toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

export function readProjectDrafts(projectId, storage) {
  if (!projectId) return [];
  const targetStorage = getStorage(storage);
  const prefix = `${PROJECT_DRAFT_PREFIX}${projectId}:`;
  const drafts = [];

  try {
    for (let index = 0; index < targetStorage.length; index += 1) {
      const key = targetStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const draft = parseDraft(targetStorage.getItem(key));
      if (draft?.projectId === projectId) drafts.push(draft.doc);
    }
  } catch {
    return [];
  }

  return drafts;
}

export function mergeProjectDrafts(projectId, savedDocs, storage) {
  const documents = Array.isArray(savedDocs) ? savedDocs.map((doc) => ({ ...doc })) : [];
  const indexById = new Map(documents.map((doc, index) => [doc.id, index]));
  const recovered = [];
  const stale = [];

  for (const draft of readProjectDrafts(projectId, storage)) {
    const index = indexById.get(draft.id);
    if (index === undefined) {
      indexById.set(draft.id, documents.length);
      documents.push({ ...draft });
      recovered.push({ ...draft });
      continue;
    }

    const saved = documents[index];
    const sameVersion =
      saved.content === draft.content &&
      saved.title === draft.title;

    if (sameVersion || timestamp(saved.updatedAt) > timestamp(draft.updatedAt)) {
      stale.push(draft.id);
      continue;
    }

    const restored = {
      ...saved,
      ...draft,
      createdAt: saved.createdAt || draft.createdAt,
    };
    documents[index] = restored;
    recovered.push(restored);
  }

  return { documents, recovered, stale };
}

export function clearProjectDraft(projectId, docId, storage) {
  if (!projectId || !docId) return;
  try {
    getStorage(storage).removeItem(draftKey(projectId, docId));
  } catch {}
}

export function clearProjectDraftIfCurrent(projectId, savedDoc, storage) {
  if (!projectId || !savedDoc?.id) return false;
  const targetStorage = getStorage(storage);
  try {
    const current = parseDraft(targetStorage.getItem(draftKey(projectId, savedDoc.id)));
    if (!current) return true;
    const matches =
      current.doc.content === savedDoc.content &&
      current.doc.title === savedDoc.title &&
      current.doc.updatedAt === savedDoc.updatedAt;
    if (matches) targetStorage.removeItem(draftKey(projectId, savedDoc.id));
    return matches;
  } catch {
    return false;
  }
}

export function clearProjectDrafts(projectId, storage) {
  if (!projectId) return;
  const targetStorage = getStorage(storage);
  const prefix = `${PROJECT_DRAFT_PREFIX}${projectId}:`;
  try {
    const keys = [];
    for (let index = 0; index < targetStorage.length; index += 1) {
      const key = targetStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => targetStorage.removeItem(key));
  } catch {}
}

