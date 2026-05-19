// Helpers for resolving the active AI provider's display name and effective model.
// Shared between App, AIPanel, StatusBar, Home, and Settings so the label stays
// consistent across the UI.

const PRESET_LABELS = {
  "https://api.groq.com/openai/v1": "Groq",
  "https://openrouter.ai/api/v1": "OpenRouter",
  "https://api.deepseek.com/v1": "DeepSeek",
};

function normalize(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

/** Returns "Ollama" | "Groq" | "OpenRouter" | "DeepSeek" | "API خارجي". */
export function getProviderName(settings) {
  if (!settings || settings.provider !== "openai_compat") return "Ollama";
  const url = normalize(settings.apiBaseUrl);
  return PRESET_LABELS[url] || "API خارجي";
}

/** Returns the user-facing status line, e.g. "Groq متصل" or "Ollama متوقف". */
export function getProviderStatusLabel(settings, status) {
  const name = getProviderName(settings);
  if (status === "online") return `${name} متصل`;
  if (status === "error") return `${name} متوقف`;
  return "جاري الفحص...";
}

/** Returns the model name to send to the backend for the current provider. */
export function getActiveModel(settings) {
  if (!settings) return "";
  return settings.provider === "openai_compat" ? settings.apiModel : settings.model;
}

/** True when running through an external (cloud) API instead of local Ollama. */
export function isExternal(settings) {
  return settings?.provider === "openai_compat";
}
