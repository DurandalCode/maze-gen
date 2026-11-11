# Android — 2026-11-11

APK-01/02 реализованы и собраны; **установка/нативный сквозной сценарий ещё not-run**, поэтому задачи не помечены полностью принятыми. APK-03, QA-01 и Android VIS/PERF остаются открытыми. `titan device list --platform android -o json` с найденным adb вернул null — подключённого устройства нет. SDK/Gradle/JDK найдены в существующем toolchain; это инструменты, не исходники старого приложения.

Новая оболочка находится в `android-reboot/`, applicationId `lab.maze.reboot`, minSdk 26/target 35. Старый `android/` не изменён и остаётся вне Git. Build: `bun run build:apk`, verify: `bun run verify:apk`. Gradle wrapper закреплён на 8.11.1 с официальным checksum; AGP 8.9.2/JDK17/SDK35. APK debug-signed, release keys не нужны. Сборка отчёта — `build.json`, подпись/package/assets — `verification.json`. Бинарный APK — generated build output, не source.

Production web assets обслуживаются офлайн под HTTPS appassets origin. Main WebView/worker origin, CSP, относительные пути и вызов chunk bridge проверены browser E2E на **production dist**, с перехватом всех запросов и без доступа к сети. Native bridge в этой проверке simulated — это не тест Android file picker/sharesheet. Подпись v2 проверена apksigner, applicationId/min/target/launcher — aapt, каждый из шести встроенных assets побайтово совпадает с dist.

ExportStore JVM oracle проверил byte identity многокускового файла, предел части/файла, sequence, одинаковый retry/no-op, конфликт retry, ранний/повторный finish, abort до/после finish, чужой файл, максимум активных экспортов и orphan .part после перезапуска. JS unit oracle проверил async ack, размер каждого bridge argument, один outstanding chunk, scope abort при неверном ack и запрет bridge вне встроенного origin. Browser worker oracle собрал portable package с 4096 samples из нескольких Base64-частей ≤256 KiB; полный Blob/JSON в UI native-пути не передаётся.

Native file picker выбирает JSON через SAF; worker проверяет байты/формат/лимиты. Экспорт: begin → части ≤192 KiB bytes/256 KiB Base64 → finish/fsync → read-only URI → sharesheet. Java IO — serial executor, UI лишь bounded relay; ack requestIds проверены, ошибки/таймаут видимы. Abort удаляет только принадлежащий операции временный файл; completed shared file не удаляется поздней отменой. SingleTask и startup cleanup ограничивают orphan exports. Старые библиотеки/внешние файлы не трогаются.

Background посылает blur/flush и onPause без глобальной остановки JavaScript; Back сначала cancellable Escape, системные insets учтены. WebGL/render-process failure оставляет confirmed IDB recovery и предлагает открыть библиотеку. Реальная работа Android WebView, SAF, sharesheet, Back/background, update-preserving-data и thermal/FPS остаются **not-run до устройства**. Эмулятором физический gate не подменён.

Веб-регрессия этапа: 108 unit tests, 14 dev Browser E2E + отдельный production-origin E2E pass, strict/build pass. Java host test pass. Инструкции сборки/протокола: `android-reboot/README.md`.

Независимую работу продолжать: E-01…03 редактора и GN-01…04 генератора доступны без физического gate; L-1000/W-60 и PC VIS/PERF ещё не приняты. Первый выпуск и исследовательские задачи не объявлены завершёнными.
