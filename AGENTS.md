# Agent notes for SubCast Mobile

The iOS / Android build of SubCast (desktop: `../subcast`). Read README.md first. Reply to the owner in Chinese.

- **Checks before a PR**: `npx tsc --noEmit -p .`, `npm run i18n -- --strict`, `cd src-tauri && cargo test --lib`.
  Interface text goes through `t("中文")` with translations in `src/locales/{en,ja,zh-TW}.ts`.
- **Git**: short branch → PR → merge commit; never push to `main`.
- **Shipping** is a store build (TestFlight / Play or a signed APK). There is no updater and no interface hot update.
- **Phones have no local ASR, no yt-dlp, no local AI agents.** Transcription is cloud only (`cloud.rs`); YouTube
  audio and streams come from InnerTube (`youtube.rs::streams`, chunked `download_stream`).
- **Tauri commands**: Rust function + `invoke_handler` + `src-tauri/build.rs` COMMANDS + `capabilities/default.json`.
  Native plugin commands (`plugins/mobile`): `build.rs` COMMANDS + `permissions/default.toml`. `addPluginListener`
  needs `register_listener` / `remove_listener` allowed there, or events silently never arrive.
- **Android**: the WebView has no `env(safe-area-inset-*)`; insets come from the plugin as `--safe-top/--safe-bottom`.
  Release serves the UI from `http://localhost:14327`, so cleartext stays allowed.
- **Driving the simulator** (agent device access off): during `npm run ios`, write `public/__nav.json`
  (see `src/lib/devnav.ts`); WebView console lines land in `/tmp/subcast-webview.log`. Android: `adb shell input tap`
  uses the screen's real pixels, not the downscaled screenshot.
- **WebView traps**: no `window.confirm/alert/prompt` (use `ask()` from `src/lib/confirm.ts`); select store slices with
  `useShallow`; never define components inside components.
- **Secrets**: never in the repo, logs or prompts (API keys, signing keys, Apple credentials).
- **Design**: no vertical side-stripe accents (border-left bars).
