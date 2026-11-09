# Maze Lab — Android

Нативная оболочка Java/WebView, Android 8.0+ (API 26), target/compile SDK 35.
Веб-приложение целиком входит в APK: сервер, аккаунт и интернет для запуска не нужны.
Данные библиотеки и прохождений хранятся в IndexedDB внутри приложения.
Нужен актуальный Android System WebView/Chrome с поддержкой WebGL 2.

## Установка и работа

1. Перенесите `maze-lab-android.apk` на телефон и откройте его. Разрешите установку из выбранного источника, если Android запросит.
2. Откройте Maze Lab: предзагруженные карты доступны в библиотеке сразу и без сети.
3. Для игры на телефоне используйте экранные элементы управления. Альбомная ориентация даёт больше места.
4. Экспорт библиотеки/записей открывает системное меню «Поделиться» с настоящим `.json`-файлом. Выберите Telegram и получателя самостоятельно.
5. Сохранённые прохождения сохраняются после закрытия приложения. Удаление приложения или очистка его данных удалит локальную библиотеку: перед этим экспортируйте JSON.

Приложение не отправляет сообщения автоматически. Разрешения на сеть и внешнее хранилище не запрашиваются. Получатель выбранного экспорта получает временный доступ только к этому файлу.

## Сборка

Закреплённые версии: JDK 17, Gradle 8.11.1, Android Gradle Plugin 8.9.2, Android SDK 35 / Build Tools 35.0.0; AndroidX WebKit 1.12.1, Core 1.15.0. Rust и NDK не используются.

На этой машине toolchain изолирован в `../work/android-toolchain/`, Bun — в `../work/bun-runtime/`. Из корня проекта:

```sh
./scripts/android-build.sh
```

Скрипт собирает веб-приложение, зеркалирует `dist/` в APK assets, собирает универсальный debug APK, проверяет подпись и печатает SHA-256. Готовый файл: `../outputs/maze-lab-android.apk`. Для упаковки уже проверенного `dist/` используйте `./scripts/android-build.sh --skip-web`.

Переопределения: `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_USER_HOME`, `GRADLE_USER_HOME`, `MAZE_ANDROID_TOOLCHAIN`, `MAZE_GRADLE`, `MAZE_BUN`, `MAZE_ANDROID_OUTPUT`. Для другой машины установите JDK 17, SDK 35 и Build Tools 35.0.0 из официальных источников, задайте соответствующие пути. Debug-ключ создаётся локально в `$ANDROID_USER_HOME/maze-debug.keystore`; сохраните его для установки обновлений поверх текущей версии с сохранением данных. Не публикуйте этот APK как production-релиз.

## Native bridge и изоляция

- `window.MazeAndroid.getPlatform(): string` → `android`.
- `window.MazeAndroid.exportData(filename: string, json: string): void` сохраняет UTF-8 JSON в cache/exports и открывает Android Sharesheet через `ACTION_SEND` и `FileProvider` с read grant. Имя файла очищается, размер ограничен 64 Mi символов. Ошибки показываются Android Toast.
- `<input type="file">` поддержан системным `ACTION_OPEN_DOCUMENT`.
- При уходе в фон отправляются `blur` и `maze:native-pause`, затем приостанавливаются WebView и JS timers; при возврате — `maze:native-resume`. Экран не засыпает, пока Activity видима.
- HTTPS origin `https://appassets.androidplatform.net/assets/` обслуживает только встроенные assets через `WebViewAssetLoader`. Все остальные запросы/переходы блокируются; `file://` и mixed content выключены; content-доступ разрешён для JSON, выбранного пользователем через системный picker. Bridge не доступен удалённым страницам.

Проверки сборки: Java компиляция, Gradle assembleDebug, apksigner, aapt и содержимое ZIP. Запуск на физическом Android-устройстве не входит в эти проверки; эмулятор не устанавливался.

Официальные основания: [совместимость AGP 8.9](https://developer.android.com/build/releases/agp-8-9-0-release-notes), [WebViewAssetLoader](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content), [безопасная передача файлов](https://developer.android.com/training/secure-file-sharing/share-file).
