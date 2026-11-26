#!/usr/bin/env bash
# Release SubCast Mobile for Android (mirrors subcast/scripts/release.sh).
#   1. Build and sign the arm64 release APK with the permanent release keystore (~/.tauri/subcast-android-release.*).
#   2. Write mobile.json (version, pub_date, Android APK url/size/sha256, and iOS TestFlight status/url).
#   3. With --publish:
#      - rsync the versioned APK to subcast.qiaomu.ai/download/mobile/<version>/
#      - update the version-free symlink subcast.qiaomu.ai/download/latest/SubCast-android.apk
#      - rsync mobile.json last (atomic publish)
#      - create or update GitHub Release android-v<version> on joeseesun/subcast-mobile with SHA256SUMS.txt
#
# Usage:
#   scripts/release-android.sh [--publish] [--notes "text"] [--ios-url "https://testflight.apple.com/join/..."] [--skip-build]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PUBLISH=0
SKIP_BUILD=0
NOTES=""
IOS_URL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --publish) PUBLISH=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --notes) NOTES="$2"; shift ;;
    --ios-url) IOS_URL="$2"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

ENV_FILE="${ANDROID_RELEASE_ENV:-$HOME/.tauri/subcast-android-release.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

if [ -z "${ANDROID_KEYSTORE:-}" ] || [ ! -f "${ANDROID_KEYSTORE:-}" ]; then
  echo "Missing release keystore. Expected ~/.tauri/subcast-android-release.env and keystore." >&2
  exit 1
fi

VERSION=$(node -p 'require("./src-tauri/tauri.conf.json").version')
TAG="android-v$VERSION"
OUT="release/android/$VERSION"
SSH_HOST="${SSH_HOST:-myvps}"
SITE_ROOT="${SITE_ROOT:-/www/wwwroot/subcast.qiaomu.ai}"
BASE_URL="https://subcast.qiaomu.ai/download/mobile/$VERSION"
APK_NAME="SubCast_${VERSION}_arm64.apk"
STABLE_NAME="SubCast-android.apk"

mkdir -p "$OUT"

if [ "$SKIP_BUILD" -eq 0 ]; then
  echo "==> Building & signing $APK_NAME with release keystore..."
  ANDROID_KEYSTORE="$ANDROID_KEYSTORE" \
  ANDROID_KEY_ALIAS="$ANDROID_KEY_ALIAS" \
  ANDROID_KEYSTORE_PASS="$ANDROID_KEYSTORE_PASS" \
  ANDROID_KEY_PASS="${ANDROID_KEY_PASS:-$ANDROID_KEYSTORE_PASS}" \
  bash scripts/android-apk.sh
fi

SIGNED_SRC="src-tauri/gen/android/app/build/outputs/apk/arm64/release/subcast-mobile-arm64-signed.apk"
test -f "$SIGNED_SRC" || { echo "Missing signed APK: $SIGNED_SRC" >&2; exit 1; }

cp "$SIGNED_SRC" "$OUT/$APK_NAME"
SHA256=$(shasum -a 256 "$OUT/$APK_NAME" | awk '{print $1}')
printf '%s  %s\n' "$SHA256" "$APK_NAME" > "$OUT/SHA256SUMS.txt"

echo "==> Writing $OUT/mobile.json..."
VERSION="$VERSION" BASE_URL="$BASE_URL" APK_NAME="$APK_NAME" SHA256="$SHA256" NOTES="$NOTES" IOS_URL="$IOS_URL" OUT="$OUT" node <<'JS'
const fs = require("fs"), path = require("path");
const { VERSION, BASE_URL, APK_NAME, SHA256, NOTES, IOS_URL, OUT } = process.env;
const size = fs.statSync(path.join(OUT, APK_NAME)).size;
const manifest = {
  version: VERSION,
  notes: NOTES || `SubCast Mobile ${VERSION}`,
  pub_date: new Date().toISOString(),
  downloads: {
    android: {
      url: `${BASE_URL}/${encodeURIComponent(APK_NAME)}`,
      size,
      sha256: SHA256,
    },
  },
  ios: IOS_URL
    ? { status: "testflight", url: IOS_URL }
    : { status: "coming_soon", url: null },
};
fs.writeFileSync(path.join(OUT, "mobile.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`version=${VERSION} size=${(size / 1048576).toFixed(1)}MB sha256=${SHA256.slice(0, 16)}...`);
JS

if [ "$PUBLISH" -eq 1 ]; then
  echo "==> Uploading APK to $SSH_HOST:$SITE_ROOT/download/mobile/$VERSION/..."
  ssh "$SSH_HOST" "mkdir -p '$SITE_ROOT/download/mobile/$VERSION' '$SITE_ROOT/download/latest'"
  rsync -av --progress --exclude mobile.json "$OUT/" "$SSH_HOST:$SITE_ROOT/download/mobile/$VERSION/"
  ssh "$SSH_HOST" "ln -sfn '../mobile/$VERSION/$APK_NAME' '$SITE_ROOT/download/latest/$STABLE_NAME' && chmod -R a+rX '$SITE_ROOT/download/mobile/$VERSION' '$SITE_ROOT/download/latest/$STABLE_NAME'"
  # mobile.json goes last so visitors never see a manifest pointing at an unuploaded APK.
  rsync -av "$OUT/mobile.json" "$SSH_HOST:$SITE_ROOT/download/mobile.json"
  ssh "$SSH_HOST" "chmod a+r '$SITE_ROOT/download/mobile.json'"

  if [ "${SKIP_GITHUB:-0}" = "0" ] && command -v gh >/dev/null 2>&1; then
    echo "==> Syncing GitHub Release $TAG..."
    STABLE_TMP="$(mktemp -d)"
    cp "$OUT/$APK_NAME" "$STABLE_TMP/$STABLE_NAME"
    if gh release view "$TAG" >/dev/null 2>&1; then
      gh release upload "$TAG" --clobber "$OUT/$APK_NAME" "$STABLE_TMP/$STABLE_NAME" "$OUT/SHA256SUMS.txt" "$OUT/mobile.json"
    else
      gh release create "$TAG" \
        "$OUT/$APK_NAME" "$STABLE_TMP/$STABLE_NAME" "$OUT/SHA256SUMS.txt" "$OUT/mobile.json" \
        --title "SubCast Android v$VERSION" \
        --notes "${NOTES:-SubCast Android v$VERSION (arm64). SHA-256: \`$SHA256\`}" || true
    fi
    rm -rf "$STABLE_TMP"
  fi
  echo "Published Android v$VERSION -> https://subcast.qiaomu.ai/download/latest/$STABLE_NAME"
else
  echo "Built into $OUT (re-run with --skip-build --publish to publish)"
fi
