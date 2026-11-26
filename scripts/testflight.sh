#!/usr/bin/env bash
# Builds the iOS store edition and uploads it to TestFlight.
#   scripts/testflight.sh <build-number>
# Needs ~/.appstoreconnect/subcast.env (ASC_KEY_ID, ASC_ISSUER_ID, ASC_PROFILE_UUID), the key at
# ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8, and an Apple Distribution certificate in the keychain.
# Nothing secret lives in the repo.
set -euo pipefail
BUILD="${1:?usage: scripts/testflight.sh <build-number>}"
source "$HOME/.appstoreconnect/subcast.env"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE="$ROOT/src-tauri/gen/apple/build/subcast-mobile_iOS.xcarchive"
OPTS="$(mktemp -t subcast-export).plist"
trap 'rm -f "$OPTS"' EXIT

cd "$ROOT"
node -e "const f='src-tauri/tauri.conf.json',c=require('./'+f);c.bundle.iOS.bundleVersion='$BUILD';require('fs').writeFileSync(f,JSON.stringify(c,null,2)+'\n')"
# The store edition: YouTube only through YouTube's own player, never downloaded (see src/lib/edition.ts).
VITE_STORE=1 npx tauri ios build --archive-only --export-method app-store-connect --features store

cat > "$OPTS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>BRCU3DPFH4</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key><dict><key>ai.qiaomu.subcast.mobile</key><string>$ASC_PROFILE_UUID</string></dict>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$OPTS" -exportPath "$(mktemp -d)" \
  -authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8" \
  -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID"
echo "Uploaded build $BUILD. It reaches the 内部测试 group in TestFlight once Apple finishes processing."
