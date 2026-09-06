import { Capacitor, registerPlugin } from "@capacitor/core";

export const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

export const NativeStorage = registerPlugin("AragonStorage");
export const NativeSpeech = registerPlugin("AragonSpeech");
export const NativeSecrets = registerPlugin("AragonSecrets");
export const NativeAI = registerPlugin("AragonAI");
