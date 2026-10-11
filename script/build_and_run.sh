#!/usr/bin/env bash
set -euo pipefail

# Build the native Mac app using the same project and settings as make apple-build.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-run}"
APP_BUNDLE="$ROOT_DIR/.cache/apple-macos/Build/Products/Debug/Eratic.app"
case "$MODE" in
  run|--debug|--logs|--telemetry|--verify) ;;
  *) echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2; exit 2 ;;
esac
if [[ $# -gt 1 ]]; then
  echo "Expected at most one option." >&2
  exit 2
fi

cd "$ROOT_DIR"
pkill -x Eratic >/dev/null 2>&1 || true
make apple-project
xcodebuild -project apps/apple/Eratic.xcodeproj -scheme Eratic-macOS \
  -destination 'platform=macOS' -derivedDataPath .cache/apple-macos \
  CODE_SIGNING_ALLOWED=NO build

if [[ "$MODE" == --debug ]]; then
  exec lldb -- "$APP_BUNDLE/Contents/MacOS/Eratic"
fi
/usr/bin/open -n "$APP_BUNDLE"
case "$MODE" in
  --logs)
    exec /usr/bin/log stream --info --style compact --predicate 'process == "Eratic"'
    ;;
  --telemetry)
    exec /usr/bin/log stream --info --style compact --predicate 'subsystem == "com.example.eratic.macos"'
    ;;
  --verify)
    sleep 1
    pgrep -x Eratic >/dev/null
    ;;
esac
