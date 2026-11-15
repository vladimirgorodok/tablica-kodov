#!/usr/bin/env bash
# Сборка APK без Gradle: aapt → javac → d8 → zipalign → apksigner.
# Подходит для ARM64-окружений, где aapt2 из Android SDK не запускается.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
RES="$ROOT/android/app/src/main/res"
SRC="$ROOT/android/app/src/main/java"
MANIFEST_SRC="$ROOT/android/app/src/main/AndroidManifest.xml"
ASSETS="$ROOT/android/app/src/main/assets"
BUILD="$ROOT/android/build-manual"
DIST="$ROOT/dist"

SDK="${ANDROID_HOME:-$ROOT/../_tools/android-sdk}"
if [ -f "$SDK/platforms/android-34/android.jar" ]; then
  PLATFORM="$SDK/platforms/android-34/android.jar"
else
  PLATFORM="$SDK/platforms/android-36/android.jar"
fi
BT="$SDK/build-tools/34.0.0"
PKG="com.codetable.app"
VERSION="1.2.1"
VERSION_CODE="6"

if [ ! -f "$ROOT/android/keystore.properties" ]; then
  echo "Нет android/keystore.properties." >&2
  echo "Скопируйте android/keystore.example.properties, задайте пароль и храните файл локально." >&2
  exit 1
fi
# shellcheck disable=SC1091
. "$ROOT/android/keystore.properties"
KS="${KEYSTORE:-$ROOT/android/release.keystore}"
KS_ALIAS="${KEY_ALIAS:-codetable}"
: "${STORE_PASSWORD:?Задайте STORE_PASSWORD в android/keystore.properties}"
KS_PASS="$STORE_PASSWORD"
KEY_PASS="${KEY_PASSWORD:-$KS_PASS}"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Не найдена команда: $1" >&2; exit 1; }
}

# D8 из build-tools 34 падает на class-файлах JDK 21, поэтому собираем JDK 17.
if [ -x "/usr/lib/jvm/java-17-openjdk-arm64/bin/javac" ]; then
  export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-arm64"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

need aapt
need javac
need jar
need zip
need zipalign
need apksigner
need keytool
[ -f "$PLATFORM" ] || { echo "Нет $PLATFORM — установите platforms;android-34" >&2; exit 1; }
[ -x "$BT/d8" ] || { echo "Нет $BT/d8 — установите build-tools;34.0.0" >&2; exit 1; }

# 0. Ресурсы веб-приложения → assets/www
if [ ! -f "$WEB/index.html" ]; then
  echo "Не найден $WEB/index.html" >&2
  exit 1
fi
rm -rf "$ASSETS"
mkdir -p "$ASSETS/www"
cp -r "$WEB/." "$ASSETS/www/"

rm -rf "$BUILD"
mkdir -p "$BUILD" "$DIST"

echo "1/7 Манифест (package, версия, uses-sdk)"
sed -e "s|<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">|<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"$PKG\" android:versionCode=\"$VERSION_CODE\" android:versionName=\"$VERSION\">|" \
    -e "s|    <application|    <uses-sdk android:minSdkVersion=\"24\" android:targetSdkVersion=\"34\" />\n    <application|" \
    "$MANIFEST_SRC" > "$BUILD/AndroidManifest.xml"
grep -q "package=\"$PKG\"" "$BUILD/AndroidManifest.xml" || { echo "Не удалось вставить package" >&2; exit 1; }
grep -q "uses-sdk" "$BUILD/AndroidManifest.xml" || { echo "Не удалось вставить uses-sdk" >&2; exit 1; }

echo "2/7 Компиляция ресурсов (aapt)"
aapt package -f \
  -M "$BUILD/AndroidManifest.xml" \
  -S "$RES" \
  -A "$ASSETS" \
  -I "$PLATFORM" \
  -F "$BUILD/resources.ap_"

echo "3/7 Компиляция Java"
find "$SRC" -name '*.java' > "$BUILD/sources.txt"
javac --release 11 -encoding UTF-8 -nowarn -cp "$PLATFORM" -d "$BUILD/classes" @"$BUILD/sources.txt"

echo "4/7 DEX"
jar cf "$BUILD/app-classes.jar" -C "$BUILD/classes" .
"$BT/d8" --release --lib "$PLATFORM" --output "$BUILD" "$BUILD/app-classes.jar"

echo "5/7 Упаковка APK"
cp "$BUILD/resources.ap_" "$BUILD/app-unsigned.apk"
(cd "$BUILD" && zip -q -j app-unsigned.apk classes.dex)
zipalign -f -p 4 "$BUILD/app-unsigned.apk" "$BUILD/app-aligned.apk"

echo "6/7 Ключ подписи"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -alias "$KS_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KS_PASS" -keypass "$KEY_PASS" \
    -dname "CN=CodeTable, O=CodeTable, C=RU" >/dev/null 2>&1
fi

echo "7/7 Подпись"
OUT="$DIST/tablica-kodov-v$VERSION.apk"
apksigner sign --ks "$KS" --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KEY_PASS" \
  --out "$OUT" "$BUILD/app-aligned.apk"
apksigner verify --print-certs "$OUT" | head -3

echo
echo "APK: $OUT ($(du -h "$OUT" | cut -f1))"
aapt dump badging "$OUT" | grep -a -E "^package:|^application-label:|^launchable-activity:|^sdkVersion:" | sed 's/^/  /'
