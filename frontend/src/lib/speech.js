import { isNativeIOS, NativeSpeech } from "./native";

const electron = typeof window !== "undefined" ? window.electronAPI : null;

export const nativeSpeechAvailable = !!electron?.startSpeechRecognition || isNativeIOS;

export async function startSpeechRecognition() {
  if (electron?.startSpeechRecognition) return electron.startSpeechRecognition();
  if (isNativeIOS) {
    try {
      await NativeSpeech.start();
      return { ok: true, active: true };
    } catch (error) {
      return { ok: false, error: error?.message || "تعذّر تشغيل الإملاء العربي" };
    }
  }
  return { ok: false, error: "الإملاء العربي يحتاج نسخة macOS أو iPad الأصلية" };
}

export async function stopSpeechRecognition() {
  if (electron?.stopSpeechRecognition) return electron.stopSpeechRecognition();
  if (isNativeIOS) return NativeSpeech.stop();
  return { ok: false };
}

export function onSpeechEvent(callback) {
  if (electron?.onSpeechEvent) return electron.onSpeechEvent(callback);
  if (!isNativeIOS) return () => {};

  let listener = null;
  let removed = false;
  NativeSpeech.addListener("speechEvent", callback).then((handle) => {
    if (removed) handle.remove();
    else listener = handle;
  });
  return () => {
    removed = true;
    listener?.remove();
  };
}
