# Maze Lab · Reboot для Android

Отдельная Java/WebView оболочка, applicationId `lab.maze.reboot`, minSdk 26, target/compileSdk 35. Старые `android/` и установленное старое приложение не заменяются. В APK входят production assets новой реализации; внешнего dev-сервера нет.

## Сборка

Нужны Bun 1.4.4/Node 22, JDK 17, Android SDK platform 35/build-tools 35.0.0 и Gradle 8.11.1 (AGP 8.9.2). Gradle wrapper закреплён с официальным distribution SHA-256. Первичная загрузка wrapper/Gradle dependencies требует сети; повторная сборка использует `--offline`.

```sh
bun install --frozen-lockfile
export JAVA_HOME=/path/to/jdk17
export ANDROID_HOME=/path/to/android-sdk
# Один раз при пустом Gradle cache:
cd android-reboot
./gradlew assembleDebug
cd ..
bun run build:apk
```

`MAZE_GRADLE` задаёт исполняемый Gradle, `MAZE_ANDROID_TOOLCHAIN` — уже установленный набор sdk/jdk-17.0.21+9/gradle-8.11.1/gradle-user. Локальный существующий `../work/android-toolchain` обнаруживается автоматически как инструмент сборки; его приложение/старые assets не используются. Чистые checkout используют checked-in wrapper. `GRADLE_USER_HOME` можно задать отдельно.

Выход: `android-reboot/app/build/outputs/apk/debug/app-debug.apk`. Hash/размер/версии — `reports/android/build.json`. Debug-подпись не является release signing; пользовательские release keys не требуются и не включены в исходники.

## Изоляция и обмен

Встроенный HTTPS origin `https://appassets.androidplatform.net/assets/` обслуживается из AssetManager. Network navigation, внешние subresources, frames и file:// доступ закрыты. CSP не разрешает исполнение содержимого JSON. IndexedDB namespace `maze-reboot-v1` изолирован applicationId/origin. Системный file picker отдаёт выбранный JSON как File, чтение/валидация идёт в storage-worker.

Native bridge `RebootNative`: begin/append/finish/abort с requestId и async receipts. Storage-worker отдаёт Base64-части до 256 KiB (исходные bytes до 192 KiB); UI пересылает только ограниченную часть и ждёт ack, максимум две неподтверждённые команды. Java пишет на serial executor, проверяет ожидаемый размер/sequence и повтор последней идентичной части, синхронизирует и завершает файл до sharesheet. Provider предоставляет только read-only URI конкретного завершённого JSON. Abort удаляет только собственный `.part`, поздний abort не удаляет уже завершённый shared file.

Blur/background останавливают прохождение и запрашивают flush; гарантия durability — периодические IDB commits. Native Back сначала отправляет cancellable Escape приложению. Insets исключают попадание HUD под system bars/cutout; resize/rotation сохраняют WebView. Сбой renderer предлагает заново открыть библиотеку с confirmed recovery.

## Проверки

Host JVM oracle:

```sh
mkdir -p work/android-host-tests
"$JAVA_HOME/bin/javac" -d work/android-host-tests android-reboot/app/src/main/java/lab/maze/reboot/ExportStore.java android-reboot/tests/ExportStoreTest.java
"$JAVA_HOME/bin/java" -cp work/android-host-tests ExportStoreTest
```

Browser E2E проверяет worker→ограниченные части→полный portable package, а unit test — async bridge ack/error/abort и byte identity. Это не замена физического теста WebView/file picker/sharesheet/обновления. Устройство сейчас не подключено; APK-03/QA-01 и Android VIS/PERF — not-run.

Справка API: [WebView](https://developer.android.com/reference/android/webkit/WebView), [локальный контент](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content), [официальный Gradle checksum](https://services.gradle.org/distributions/gradle-8.11.1-bin.zip.sha256).
