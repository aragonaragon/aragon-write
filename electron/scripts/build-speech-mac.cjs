const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

if (process.platform !== "darwin") {
  console.log("Speech helper is only built on macOS.");
  process.exit(0);
}

const root = path.join(__dirname, "..", "..");
const bundle = path.join(root, "electron", "bin", "AragonSpeechHelper.app");
const contents = path.join(bundle, "Contents");
const macOS = path.join(contents, "MacOS");
const executable = path.join(macOS, "AragonSpeechHelper");
const source = path.join(root, "electron", "native", "SpeechHelper.swift");
const plist = path.join(root, "electron", "native", "SpeechHelper-Info.plist");

fs.rmSync(bundle, { recursive: true, force: true });
fs.mkdirSync(macOS, { recursive: true });
fs.copyFileSync(plist, path.join(contents, "Info.plist"));

const compile = spawnSync("xcrun", [
  "swiftc",
  source,
  "-O",
  "-target", "arm64-apple-macos13.0",
  "-framework", "AppKit",
  "-framework", "AVFoundation",
  "-framework", "Speech",
  "-o", executable,
], { stdio: "inherit" });

if (compile.status !== 0) process.exit(compile.status || 1);

const sign = spawnSync("codesign", ["--force", "--sign", "-", bundle], { stdio: "inherit" });
if (sign.status !== 0) process.exit(sign.status || 1);

console.log(`Built native Arabic speech helper: ${bundle}`);
