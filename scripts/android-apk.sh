#!/usr/bin/env bash
# Build, align, sign, and optionally install a SubCast Android APK.
# Usage:
#   scripts/android-apk.sh                 # arm64 release APK (signed with debug.keystore by default)
#   scripts/android-apk.sh --install       # also install & launch on the connected ADB phone
#   scripts/android-apk.sh --store         # Google Play store edition (VITE_STORE=1 + --features store)
#   scripts/android-apk.sh --universal     # all ABIs instead of arm64 only
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="aarch64"
ABI_DIR="arm64"
GRADLE_TASK=":app:assembleArm64Release"
RUST_SKIP="-x rustBuildArm64Release"
LINT_SKIP="-x lintVitalAnalyzeArm64Release -x lintVitalReportArm64Release -x lintVitalArm64Release"
STORE=0
INSTALL=0

for arg in "$@"; do
  case "$arg" in
    --universal)
      TARGET=""
      ABI_DIR="universal"
      GRADLE_TASK=":app:assembleUniversalRelease"
      RUST_SKIP="-x rustBuildUniversalRelease"
      LINT_SKIP="-x lintVitalAnalyzeUniversalRelease -x lintVitalReportUniversalRelease -x lintVitalUniversalRelease"
      ;;
    --store) STORE=1 ;;
    --install) INSTALL=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

export PATH="$HOME/.cargo/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/$(ls "$ANDROID_HOME/ndk" | sort -V | tail -1)}"
if [ -z "${JAVA_HOME:-}" ] && [ -d "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home" ]; then
  export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
fi
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$ANDROID_HOME/platform-tools:$PATH"

BUILD_TOOLS="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"
KS_PATH="${ANDROID_KEYSTORE:-$HOME/.android/debug.keystore}"
KS_ALIAS="${ANDROID_KEY_ALIAS:-androiddebugkey}"
KS_PASS="${ANDROID_KEYSTORE_PASS:-android}"
KEY_PASS="${ANDROID_KEY_PASS:-$KS_PASS}"

BUILD_ARGS=(android build --apk)
if [ -n "$TARGET" ]; then
  BUILD_ARGS+=(--target "$TARGET")
fi
if [ "$STORE" -eq 1 ]; then
  export VITE_STORE=1
  BUILD_ARGS+=(-- --features store)
fi

echo "==> Building frontend + Rust (${ABI_DIR}, store=${STORE})..."
rm -f "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk" \
      "src-tauri/gen/android/app/build/outputs/apk/${ABI_DIR}/release/app-${ABI_DIR}-release-unsigned.apk"
# Tauri compiles frontend + Rust .so; if Gradle lintVital fails offline, fall back to offline assemble below.
if npx tauri "${BUILD_ARGS[@]}"; then
  UNSIGNED="src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk"
else
  echo "==> Retrying Gradle assemble offline without lintVital..."
  (cd src-tauri/gen/android && ./gradlew "$GRADLE_TASK" --offline $RUST_SKIP $LINT_SKIP)
  UNSIGNED="src-tauri/gen/android/app/build/outputs/apk/${ABI_DIR}/release/app-${ABI_DIR}-release-unsigned.apk"
fi

APK_DIR="src-tauri/gen/android/app/build/outputs/apk/${ABI_DIR}/release"
mkdir -p "$APK_DIR"
SUFFIX=""
[ "$STORE" -eq 1 ] && SUFFIX="-store"
OUT_APK="$APK_DIR/subcast-mobile-${ABI_DIR}${SUFFIX}-signed.apk"

test -f "$UNSIGNED" || { echo "Missing unsigned APK: $UNSIGNED" >&2; exit 1; }

echo "==> Aligning & signing $OUT_APK..."
"$BUILD_TOOLS/zipalign" -f -p 4 "$UNSIGNED" "${OUT_APK}.aligned"
"$BUILD_TOOLS/apksigner" sign \
  --ks "$KS_PATH" \
  --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" \
  --key-pass "pass:$KEY_PASS" \
  --out "$OUT_APK" \
  "${OUT_APK}.aligned"
rm -f "${OUT_APK}.aligned"
"$BUILD_TOOLS/apksigner" verify --verbose "$OUT_APK"
ls -lh "$OUT_APK"

if [ "$INSTALL" -eq 1 ]; then
  echo "==> Installing onto connected ADB device..."
  adb install -r "$OUT_APK"
  adb shell am start -n ai.qiaomu.subcast.mobile/.MainActivity
fi
