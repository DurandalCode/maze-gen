#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TOOLCHAIN=${MAZE_ANDROID_TOOLCHAIN:-"$ROOT/../work/android-toolchain"}
if [[ -z "${JAVA_HOME:-}" ]]; then
  for JDK in "$TOOLCHAIN"/jdk-17*/Contents/Home; do
    [[ -x "$JDK/bin/java" ]] && export JAVA_HOME="$JDK" && break
  done
fi
export ANDROID_HOME=${ANDROID_HOME:-"$TOOLCHAIN/sdk"}
export ANDROID_USER_HOME=${ANDROID_USER_HOME:-"$TOOLCHAIN/android-user"}
export GRADLE_USER_HOME=${GRADLE_USER_HOME:-"$TOOLCHAIN/gradle-user"}
[[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]] || { echo 'JDK 17 missing: set JAVA_HOME.' >&2; exit 1; }
export PATH="$JAVA_HOME/bin:$PATH"
GRADLE=${MAZE_GRADLE:-"$TOOLCHAIN/gradle-8.11.1/bin/gradle"}
[[ -x "$GRADLE" ]] || GRADLE="$ROOT/android/gradlew"
BUN=${MAZE_BUN:-"$ROOT/../work/bun-runtime/node_modules/.bin/bun"}
[[ -x "$GRADLE" ]] || { echo "Gradle missing: see android/README.md" >&2; exit 1; }
if [[ "${1:-}" != '--skip-web' ]]; then
  (cd "$ROOT" && "$BUN" run build)
fi
[[ -f "$ROOT/dist/index.html" ]] || { echo 'Build dist/ before packaging.' >&2; exit 1; }
mkdir -p "$ANDROID_USER_HOME" "$ROOT/android/app/src/main/assets"
if [[ ! -f "$ANDROID_USER_HOME/maze-debug.keystore" ]]; then
  "$JAVA_HOME/bin/keytool" -genkeypair -noprompt -keystore "$ANDROID_USER_HOME/maze-debug.keystore" \
    -storepass android -keypass android -alias androiddebugkey -dname 'CN=Maze Lab Development,O=Maze Lab,C=US' \
    -keyalg RSA -keysize 2048 -validity 10000
fi
export MAZE_ANDROID_KEYSTORE="$ANDROID_USER_HOME/maze-debug.keystore"
# Mirror the latest web build; no stale bundles or network server dependency.
rsync -a --delete "$ROOT/dist/" "$ROOT/android/app/src/main/assets/"
"$GRADLE" -p "$ROOT/android" --no-daemon assembleDebug
OUTPUT=${MAZE_ANDROID_OUTPUT:-"$ROOT/../outputs/maze-lab-android.apk"}
mkdir -p "$(dirname "$OUTPUT")"
cp "$ROOT/android/app/build/outputs/apk/debug/app-debug.apk" "$OUTPUT"
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --verbose "$OUTPUT"
python3 "$ROOT/scripts/android-verify.py" "$OUTPUT"
echo "APK: $OUTPUT"
