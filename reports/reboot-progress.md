# Продолжение реализации Maze Lab

Рабочий репозиторий: `/Users/tylys/Documents/Codex/2026-11-09/new-chat/maze-gen`.
Ветка: `reboot/sdd-clean-start`, remote `https://github.com/DurandalCode/maze-gen.git`.

Пользователь поручил реализовать SDD **до конца**. Постоянная цель Codex активна; не завершать её до фактического выполнения доступной работы. Дополнительное подтверждение для обычных следующих задач не нужно. Подагенты не разрешены текущими инструкциями. Не создавать другие чаты.

## Текущая точка

Созданы новое приложение/конфигурация, domain schema/hashes/PRNG, каталог, геометрия/PhysicalSnapshot, навигация/семантический граф/непрерывное движение, workers, IndexedDB, chunks/Recorder и первый новый 2D/3D renderer. Главная страница всё ещё bootstrap: эти модули ещё надо связать в пользовательские сценарии. Первый выпуск не готов.

Завершены: B-01/02/03, G-01…04, N-01/02, J-01, DB-01/03, REC-01. Подробные доказательства в `reports/B-01.md`, `core-foundation.md`, `runtime-foundation.md`, `fixtures/results.json`. В работе: J-02, DB-02, REC-02/03, R-01/02. Остальные задачи — `docs/reboot/sdd/tasks.md`.

Проверки этапа: build/check и 92 unit tests; 5 браузерных тестов (bootstrap, Bun/Chromium hash/PRNG, compute worker transfer/cancel/restart, storage persistence, 3D/shader/GPU disposal). Контекст objectIds/location включён в диагностику и проверен отдельным тестом. Финальный полный прогон: все 15 fixtures pass, sourceUnchangedDuringRun=true. Отрицательные случаи правильно отклонены.

## Следующие действия

1. Связать пользовательский прототип: библиотека, независимые загрузки карт/прохождений, 2D/3D просмотр, blind start, keyboard/touch, пауза/результат/запись/восстановление. Использовать готовые compute/storage workers и Recorder; не вычислять геометрию в React.
2. Закрыть VIS-01/R-01/R-02: восемь зафиксированных камер `reports/visual/scenes.json`, roof holes, близкие поры/контровой свет, actual context loss/resize и 20 GPU циклов. Визуальная fixture — `visualFixture()`; она намеренно строительная, с закрытыми circle/triangle, и не объявляется ready-картой. `RenderWorld` отделён от `PreparedWorld` именно для такого просмотра.
3. Закрыть DB-02 через L-1000/PERF-04 и REC-02 через реальную запись/worker/main-thread проверку. Функциональные методы уже есть, но performance gate ещё не pass.
4. IO-01…03 (JSON preflight/staging/atomic commit/conflicts/chunked export), APK-01…03, QA-01; затем E/GN/QA по зависимостям. E-01…03 и GN-01…04 могут продолжаться независимо от отсутствующего телефона; E-04/QA нуждаются в соответствующих gates.
5. AN-01…06 — по SDD после первого выпуска. Для AN-05 нужны реальные человеческие данные; AN-06 разрешён только после validated. Не подменять это синтетикой и не объявлять целью достигнутой без внешних gates.

## Важные инженерные решения

- Стек TypeScript strict / React / Vite / Three / Bun / Playwright. Dev origin `http://127.0.0.1:1421`, strictPort.
- Ключевые команды: `bun run build`, `bun run check`, `bun test tests/unit`, `bun run test:e2e`, `bun scripts/verify-fixtures.ts`, `bun run format`.
- Bun доступен локально: `/Users/tylys/Documents/Codex/2026-11-09/new-chat/work/bun-runtime/node_modules/bun/bin/bun` (1.4.4). Вызовы задают этот каталог в PATH. Cache: `/Users/tylys/Documents/Codex/2026-11-11/new-chat/work/bun-cache`.
- Тестовый Chromium установлен в `/Users/tylys/Documents/Codex/2026-11-11/new-chat/work/playwright-browsers`; перед browser tests выставлять `PLAYWRIGHT_BROWSERS_PATH`. Открытие localhost в shell требует escalated execution из-за sandbox; действия уже авторизованы задачей.
- Boolean/offset: clipper2-ts 2.0.1-19, earcut 3.0.2. Старые polygon-clipping/clipper-lib удалены. `geometry-v3-clipper2`, `nav-v2-round-offset`, сетка 10⁻⁷ м. Проверка площади сравнивает quantized операнды. Ошибки библиотеки не превращаются в успех; guard Clipper64.execute важен и для внутреннего offset cleanup.
- Физическая ткань 0,006 м, доски 0,12×0,04 м. Опоры выбираются по настоящим углам/проёмам/пролёту, не на каждом визуальном сегменте дуги. Footprints досок/укосин — проекция реального 3D box. Крепёж также находится в PhysicalSnapshot и смете.
- Физический envelope проверяется внутри site. M-50/M-100 исходные количества сохранены. Лимит производных физических сегментов поднят с 100k до 400k по обнаруженному конфликту исходной SDD; входные сериализованные сегменты по-прежнему 100k. Изменение объяснено пользователю и записано в SDD.
- B-03 источники/маршруты/hashes сохранены; не менять нагрузку ради оптимизации. M-50 функциональная подготовка пока превышает целевые 3 с. Это не принятый PERF-05; нужны дальнейшие оптимизации/кеширование с замерами.
- Архитектурный checker запрещает core зависимости на DOM/React/Three/adapters/legacy. Ядро отдельно компилируется без DOM. Любая новая библиотека ядра допускается только за kernel adapter и с оракулами.
- `JobManager` отменяет/terminate текущий compute немедленно. Для будущего atomic import нужна commit-aware отмена: нельзя заявить cancelled после уже завершённого IDB commit. Не применять бездумно immediate terminate к write commit.
- Storage namespace `maze-reboot-v1`; sessions/summary/chunks пишутся атомарно. `Recorder` не хеширует chunks в UI, это делает storage worker. Queue max 5 и текущий ограниченный буфер, error/backpressure => pause, retry сохраняет sequence, finish idempotent.
- `WorldScene.dispose()` вызывает dispose instanced meshes/geometries/materials/textures, снимает listeners/observer/RAF, освобождает shadow/renderer/context. Новый renderer ещё надо проверить двадцатью реальными циклами и context-loss.

## Сохранённые старые файлы

`android/` сейчас целиком untracked: это сохранённые старые assets/build/APK. Не добавлять их в Git и не удалять. Для новой Java/WebView оболочки разумно использовать отдельный `android-reboot/` и applicationId `lab.maze.reboot`, чтобы не смешать старые ресурсы. `.tools`, прежние сборки и node_modules не являются исходниками. Старый source доступен в Git `ccd19ff` только для справки; не восстанавливать legacy.

Изменения надо фиксировать локальными reviewable checkpoints; push/PR ещё не выполнялись. Первая стадия прошла финальные проверки и фиксируется локальным checkpoint. Не объявлять выполненными Android, VIS/PERF, JSON/editor/generator или исследования, пока их нет.
