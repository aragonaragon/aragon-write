import { isNativeIOS, NativeStorage } from "./native";

/**
 * Storage boundary shared by the desktop UI and the iPad shell.
 *
 * The React editor talks only to this interface for projects and documents.
 * Today it uses the local desktop service. The iPad target can supply an
 * iCloud-backed implementation without changing editor components or state.
 */
export function createDesktopStorage(baseUrl) {
  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, options);
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error || `Storage request failed (${response.status})`);
    }
    return data;
  }

  return {
    listProjects: () => request("/fs/projects"),
    createProject: (title) => request("/fs/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
    deleteProject: (projectId) => request(`/fs/projects/${projectId}`, { method: "DELETE" }),

    listDocuments: (projectId) => request(`/fs/projects/${projectId}/docs`),
    createDocument: (projectId, document) => request(`/fs/projects/${projectId}/docs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(document),
    }),
    saveDocument: (projectId, document) => request(`/fs/projects/${projectId}/docs/${document.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(document),
      keepalive: true,
    }),
    deleteDocument: (projectId, documentId) => request(`/fs/projects/${projectId}/docs/${documentId}`, {
      method: "DELETE",
    }),

    exportProject: (projectId) => request(`/backup/export-project?id=${encodeURIComponent(projectId)}`),
    importProject: (json) => request("/backup/import-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json, target: "new" }),
    }),
  };
}

export function createNativeStorage() {
  return {
    status: () => NativeStorage.status(),
    listProjects: async () => (await NativeStorage.listProjects()).items || [],
    createProject: async (title) => (await NativeStorage.createProject({ title })).item,
    deleteProject: (projectId) => NativeStorage.deleteProject({ projectId }),

    listDocuments: async (projectId) => (await NativeStorage.listDocuments({ projectId })).items || [],
    createDocument: async (projectId, document) => (
      await NativeStorage.createDocument({ projectId, document })
    ).item,
    saveDocument: async (projectId, document) => (
      await NativeStorage.saveDocument({ projectId, document })
    ).item,
    deleteDocument: (projectId, documentId) => NativeStorage.deleteDocument({ projectId, documentId }),

    async exportProject(projectId) {
      const projects = await this.listProjects();
      const project = projects.find((item) => item.id === projectId);
      const docs = await this.listDocuments(projectId);
      return {
        _format: "aragon-write-backup",
        _version: 1,
        exportedAt: new Date().toISOString(),
        project,
        docs,
      };
    },
    async importProject(json) {
      const source = typeof json === "string" ? JSON.parse(json) : json;
      if (source?._format !== "aragon-write-backup" || !Array.isArray(source.docs)) {
        throw new Error("ملف النسخة الاحتياطية غير صالح");
      }
      const project = await this.createProject(source.project?.title || "كتاب مستورد");
      for (const document of source.docs) await this.createDocument(project.id, document);
      return { ok: true, projectId: project.id, docCount: source.docs.length };
    },
  };
}

export function createStorage(baseUrl) {
  return isNativeIOS ? createNativeStorage() : createDesktopStorage(baseUrl);
}
