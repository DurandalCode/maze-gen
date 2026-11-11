# Исполнение, данные, запись и рендер: промежуточный результат

Дата: 2026-11-11. Это проверяемый этап реализации, не готовность первого выпуска.

## Готовые части

- J-01: protocolVersion=1, состояние queued/running/terminal, ограниченная очередь, объединение pending-ревизий владельца, stale-result защита, один terminal outcome, lazy restart, abort/dispose. Проверки: late results, crash/restart, queue overflow, 20 циклов открытия/закрытия.
- J-02: compute worker выполняет compile/navigation/metrics и отдаёт один готовый результат. Буферы floor/roof/ground создаются отдельно от активных данных и передаются как transferable. Браузер проверил, что первый активный буфер не detaches после следующей работы и пересоздания worker. Полный PERF-06 по всем тяжёлым этапам ещё не принят.
- DB-01: отдельная база maze-reboot-v1, schema/indexes, storage worker, атомарные maps/definitions/summaries/project pointer. Ошибка quota откатывает всю транзакцию; повтор не создаёт дублей. Save/restore проверены в реальном Chromium после terminate/reopen worker.
- DB-02/03: pagination/search/sort читает только summaries; cursor стабилен при равных датах и именах. Draft recovery, stale/conflicting draft, rename с прежним hash, удаление с учётом projects/sessions/drafts и garbage collection. Одна повреждённая карта не блокирует список и соседнюю карту, исходное тело доступно отдельно. L-1000/PERF-04 и экран библиотеки ещё не приняты.
- REC-01/02: prepared требует сохранённой ready-карты; физические шаги и 10 Гц samples разделены; chunks каждые 2 с или до 256 samples. Sequence/idempotency/conflict/gap, atomic header+chunk+summary, terminal state не откатывается поздней записью. Очередь ограничена пятью chunks; переполнение/ошибка ставят прохождение на паузу. Retry сохраняет sequence/body; finish повторяется без переписывания chunks.
- REC-03: interrupted recovery использует последний подтверждённый sample/time/distance/sequence; lifecycle adapter сразу останавливает движение и запрашивает flush. Полная интеграция с R-02/UX ещё продолжается.
- R-01/02: начаты 2D Canvas и 3D Three.js из PhysicalSnapshot. В 3D видны ткань/поры/контровой свет, деревянные элементы, крыша, крепёж, лес, солнце и земля. Размеры и расположение крепежа задаёт компилятор; смета использует те же элементы. Снята первая обзорная сцена в Chromium без shader errors; renderer.info вернулся к нулю после dispose. Восемь VIS-сцен, 20 реальных GPU циклов, resize/context-loss и PERF ещё не приняты.

## Проверки

Функциональные тесты исполняются `bun test tests/unit`; браузерные — `bun run test:e2e`. На момент этого этапа проходили 92 unit tests и отдельные браузерные проверки bootstrap/hash/compute/storage/render. После смены kernel полный браузерный набор повторён: 5/5 pass.

Синтетическая часовая запись подтверждает ограниченные части и независимость дистанции от samples; она не считается выполнением PERF-07 с реальным рендером/IndexedDB на Android.

## Что ещё не сделано

Главная страница пока остаётся bootstrap. Реализованные модули ещё надо связать в пользовательские сценарии библиотеки/просмотра/прохождения, редактора, генерации и файлового обмена. Новый APK не собран. Физический Android, VIS/PERF и исследовательский этап не приняты. Зелёные unit tests не означают завершённую SDD.
