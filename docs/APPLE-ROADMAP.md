# Aragon Write — macOS + iPad roadmap

## Product boundary

Aragon Write is an Arabic-first long-form writing studio. The primary surface is
the document; projects, chapters, formatting, focus mode, backup, AI assistance,
and sync exist only to support writing. Features that do not improve drafting,
revision, or safe storage stay out of the main interface.

## Target architecture

- **Shared editor:** React + TipTap, used by macOS and iPad.
- **macOS shell:** Electron for the first complete desktop release.
- **iPad shell:** Capacitor/WKWebView, with native Swift bridges only for storage,
  iCloud, Keychain, document import/export, and platform commands.
- **Storage:** one JSON file per chapter plus one project metadata file. This is
  already the desktop format and avoids rewriting a whole book for every save.
- **Sync:** local-first iCloud container. Each device writes locally, observes
  iCloud changes, and resolves chapter-level conflicts without blocking writing.
- **AI:** Ollama remains available on macOS. iPad uses the configured external
  provider; the editor continues working when AI or the network is unavailable.

## Sync rules

1. Every project and chapter has a stable ID, `updatedAt`, revision, and device ID.
2. Changes are saved locally before any sync attempt.
3. Different chapters merge automatically.
4. If the same chapter changes independently on two devices, keep both versions;
   never discard text silently. The second version appears as a recoverable
   conflict copy with device and date.
5. Deletes use tombstones during sync rather than immediate remote erasure.
6. A visible status has four states only: local, syncing, synced, needs attention.
7. Exported backups never include API keys or Keychain content.

## Delivery order

1. **Complete:** harden and package the full macOS editor.
2. **Complete:** keep project/document access behind `frontend/src/lib/storage.js`.
3. **Complete:** add Capacitor and create an iPad-only target.
4. **Complete:** add Arabic dictation on macOS and iPad using Apple Speech.
5. **Complete:** implement local-first iPad storage with iCloud-container fallback
   and revision metadata.
6. **Next signed milestone:** activate the iCloud container with an Apple Team,
   add the matching signed macOS iCloud bridge, and validate two-way sync on
   physical devices.
7. Add conflict copies, tombstones, and background observation before trusting
   sync with irreplaceable manuscripts.

## Implemented and verified in 2.6.0

- macOS arm64 package builds, launches, saves, and passes strict deep code-sign
  verification with local ad-hoc signing.
- Arabic dictation starts and stops on macOS, reports whether recognition is
  on-device, inserts partial results at the editor selection, and has a 55-second
  safety stop.
- The iPad simulator build launches, creates a first chapter for an empty book,
  saves native JSON storage, and restores the exact text after termination.
- The iPad target includes the same Arabic dictation bridge and permission flow.
  Audio recognition itself still needs a physical iPad test because the simulator
  has no usable microphone input.
- `npm audit` reports zero known vulnerabilities after the 2.6.0 dependency update.

## Current prerequisites

- Use Node 22 (`.nvmrc`) for repeatable packaging.
- Xcode is installed and iPad simulators are available.
- An Apple signing identity and iCloud container are still required for real
  on-device iCloud sync. The current Mac has no valid code-signing identity.
- Capacitor dependencies and the iPad Xcode project are already present.
- Keep desktop storage local until the signed shared container is available;
  switching roots early could make existing books appear missing.

## Performance budget

- No network fonts or decorative image downloads.
- No background polling faster than needed for save/sync state.
- Keep the editor bundle lazy where practical; load document converters only on use.
- Keep animations limited to opacity and transform, honoring reduced motion.
- Measure idle CPU, typing latency, launch time, and memory on both targets before
  calling a milestone complete.
