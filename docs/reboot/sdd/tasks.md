# Задачи реализации

Статус: **выполнены B-01/02, G-01…04, N-01/02**. Результаты проверок: [B-01](../../../reports/B-01.md). Остальные задачи выполняются по зависимостям. Новое ядро проверено на контрольных случаях, масштабирование ещё не принято.

Контракты: [решения](decisions.md), [геометрия](geometry.md), [генератор](generator.md), [исполнение/данные/UX](runtime-storage.md), [приёмка](acceptance.md), [исследовательский этап](analysis.md). Gates — [plan.md](plan.md).

Пути результатов относительно корня репозитория. Старые отслеживаемые исходники удалены по решению пользователя; файлы вне Git сохранены и не входят в новую реализацию. Задача завершена только после указанной проверки. При провале критерия исправляется реализация; требование не ослабляется молча. Тесты используют независимые оракулы, а не повторяют код.

## Основа и геометрия

| ID | Задача и результат | Зависит от | Критерий готовности |
|---|---|---|---|
| B-01 | **Выполнено, [отчёт](../../../reports/B-01.md).** Новое приложение в корне, package.json/lockfile, dev/build/check/test, правила импортов; src/ и tests/ | — | Чистая сборка/запуск по новой конфигурации; ядро не импортирует legacy, React/Three/DOM; сохранённые .tools/dist не используются как исходники; dev origin 1421 |
| B-02 | **Выполнено, [отчёт](../../../reports/core-foundation.md).** Целевые визуальные сцены и профиль вида; reports/visual/ и visual fixture settings | B-01 | VIS-01 описан с камерами/настройками и всеми требуемыми элементами; физическая толщина и каркас заданы единым профилем; старое приложение запускать не требуется, отсутствующие эталоны явно отмечены |
| G-01 | **Выполнено, [отчёт](../../../reports/core-foundation.md).** Схема Document/Definition/Instance, нормализация, hashes и входные лимиты; src/domain/ | B-01 | NaN/Infinity/duplicate IDs/unknown primitive отклоняются; canonical round-trip; metadata не меняет geometry hash |
| G-02 | **Выполнено, [отчёт](../../../reports/core-foundation.md).** Каталог и параметры 4 контрольных форм; src/catalog/ | G-01 | Rectangle/triangle/circle/explicitLoops дают общий contour; версия и параметры проверяются; definition отделено от instance |
| G-03 | **Выполнено, [отчёт](../../../reports/core-foundation.md).** Boolean/triangulation адаптер, дуги и допуски; src/geometry/kernel/ | G-01 | GEO-01/03/06: аналитические площади, отверстия, касания и вырождения; нет NaN/разрывов; ошибка библиотеки не становится успехом |
| G-04 | **Выполнено, [отчёт](../../../reports/core-foundation.md).** Проёмы, соединения, панели/опоры/крыша и PhysicalSnapshot; src/geometry/compile/ | G-02, G-03 | GEO-02/04/06; круг с проёмом через начало дуги, direct-join, реальный просвет, пролёты; смета по тем же элементам |
| N-01 | **Выполнено, [отчёт](../../../reports/core-foundation.md).** Проходимая область, navmesh, семантический граф и маршрут; src/navigation/ | G-04 | GEO-02/03/04; cycles/развилки не зависят от triangulation; центроид вне пола не ломает путь; маршрут проверен физикой |
| N-02 | **Выполнено, [отчёт](../../../reports/core-foundation.md).** Непрерывное движение/скольжение и общий контроллер; src/session/movement/ | N-01 | Swept path не пересекает стены, большой dt не телепортирует; скорости 1,4/2,8; keyboard/touch сопоставимы |
| B-03 | **Выполнено, [отчёт](../../../reports/fixtures/README.md).** Независимые F-01…05, M-50/M-100 и маршруты benchmark; tests/fixtures/ | G-04, N-02 | Допустимые fixtures валидны, ошибочные дают ожидаемые codes; hashes и состав фиксированы до оптимизации |

G-03 — ограниченная проверка выбранного kernel: если он не проходит оракулы, заменить адаптер и повторить те же проверки до распространения дефекта дальше. Fixtures создаются независимо от нового генератора.

## Исполнение и рендер

| ID | Задача и результат | Зависит от | Критерий готовности |
|---|---|---|---|
| J-01 | **Выполнено, [отчёт](../../../reports/runtime-foundation.md).** Jobs state machine, protocol, bounded queue/cancel; src/jobs/ | G-01 | RUN-01 на медленном/падающем worker; stale revision отбрасывается, terminal event один, очередь ограничена |
| J-02 | **В работе.** Compile/navigation/metrics в compute-worker | J-01, N-01 | Snapshot передаётся один раз; transfer не detatch активный буфер; PERF-06; recovery после terminate |
| R-01 | **В работе.** 2D/3D из PhysicalSnapshot, материалы и disposal; src/renderer/ | G-04, B-02 | F-02: те же проёмы/стены/опоры, отверстия крыши; VIS-01; dispose проверен |
| R-02 | **Выполнено на ПК, [отчёт](../../../reports/ui-runtime.md).** Камера, окружение, прозрачность, resize/context-loss | R-01, N-02, J-02 | Полный вид; FAIL-04; пауза/восстановление; нет лишних RAF/listeners после открытия/закрытия |
| R-03 | CPU/GPU-профиль и оптимизация без потери вида | R-02, B-03 | VIS-01+PERF-01/08 на ПК, PERF-09 отчёт; конкретные bottlenecks закрыты; Android проверяется APK-03 |

## Хранение, запись и обмен

| ID | Задача и результат | Зависит от | Критерий готовности |
|---|---|---|---|
| DB-01 | **Выполнено, [отчёт](../../../reports/runtime-foundation.md).** IndexedDB schema/indexes, repository и storage-worker | G-01, J-01 | DB-02 atomicity; summaries согласованы; quota/schema errors не меняют старые указатели; старые базы не затронуты |
| DB-02 | **В работе.** Pagination/search/sort summaries и отдельная загрузка тел | DB-01 | DB-01 оракул, L-1000/PERF-04; список не читает maps/chunks; stable cursor при равных датах |
| DB-03 | **Выполнено, [отчёт](../../../reports/runtime-foundation.md).** Draft/revisions, rename/delete, повреждения и сбор неиспользуемых данных | DB-01 | Draft восстанавливается; rename сохраняет hash; удаление учитывает ссылки; одна плохая запись не блокирует библиотеку |
| REC-01 | **Выполнено, [отчёт](../../../reports/runtime-foundation.md).** Session/condition, fixed-step distance, chunks 10 Гц | N-02, DB-01 | REC-01 оракул; дистанция независима от частоты записи; paused не добавляет activeTime; prepared требует сохранённой карты |
| REC-02 | **В работе.** Idempotent flush/finalize, backpressure и ошибки | REC-01 | Повтор sequence no-op, конфликт явный, finish не откатывается; FAIL-01/05, W-60/PERF-07; очередь ограничена |
| REC-03 | **Выполнено на ПК, [отчёт](../../../reports/ui-runtime.md).** Interrupted recovery и lifecycle hooks | REC-02, R-02 | Перезапуск с последнего commit/sequence, без скачка; неподтверждённый интервал обозначен; listeners освобождены |
| IO-01 | **В работе: строгий parser/dependency/hash preflight и 4 оракула.** Package schema, dependency closure, hashes и preflight | G-02, DB-01, REC-01 | IO-01/02; F-02 восстанавливается без каталога; limits до allocation; старые форматы отклоняются |
| IO-02 | Staging, conflict preview и atomic import | IO-01, DB-03, J-02 | DB-02/IO-02/FAIL-02; duplicate no-op; конфликт не затирает; отмена до commit не меняет библиотеку |
| IO-03 | Экспорт выбора и разбиение на пакеты 32 MiB | IO-01, REC-02 | Каждый пакет самодостаточен; dependencies полны; сериализация в worker, полного JSON в React нет |

## APK и сценарии первого прототипа

| ID | Задача и результат | Зависит от | Критерий готовности |
|---|---|---|---|
| UX-01 | **В работе: функциональный сценарий проверен в браузере; L-1000/PERF открыт.** Библиотека/карточка/просмотр, независимые loading/error | DB-02, DB-03, R-02 | UX-01 оракул; 30 строк первой страницы; поиск/вкладки доступны при ошибке; touch ≥44px |
| UX-02 | **В работе: browser E2E pass; зависимые gates открыты.** Слепой старт, пауза и результат | UX-01, REC-03 | План/раскрывающее имя не показаны; previewed записан; saving/saved/error различимы |
| UX-03 | Импорт/экспорт/конфликты | UX-01, IO-02, IO-03 | Выбор→проверка→итог→commit/cancel; дубликаты и несовместимость понятны; несколько экспортных пакетов |
| APK-01 | Отдельная Java/WebView оболочка и APK build script | B-01 | applicationId lab.maze.reboot, встроенные assets; debug APK устанавливается, старое приложение доступно |
| APK-02 | File picker, chunked export/sharesheet, background hooks | APK-01, UX-03, REC-03 | Нет одного блокирующего многомегабайтного bridge-вызова; cancel чистит только свой временный файл; JSON читается на ПК |
| APK-03 | Физическое устройство: обмен, lifecycle, обновление и графический gate | APK-02, UX-02, R-03 | IO-01, FAIL-04/05, PERF-02/08, VIS-01; APK без сервера; обновление сохраняет библиотеку; устройство/WebView в отчёте |
| QA-01 | Gate сквозного прототипа | UX-02, UX-03, APK-03 | ПК JSON→APK play→restart→JSON→ПК; pass/fail/not-run без скрытых невыполненных проверок |

## Редактор ПК

| ID | Задача и результат | Зависит от | Критерий готовности |
|---|---|---|---|
| E-01 | Command store, revision domains, patches undo/redo | G-01, J-01, DB-03 | 100 команд; drag одна команда; цвет/имя не инвалидируют navmesh; hashes после undo/redo |
| E-02 | План/selection/hit-test/transform preview/числовые свойства | E-01, R-01, B-03 | Круг/треугольник выбираются по форме; локальный preview, rotate/snap; PERF-03 |
| E-03 | Проёмы/соединения/стены и ошибки | E-02, G-04, J-02 | Привязки после поворота/параметров устойчивы; invalid draft доступен; stale validation не включает Play |
| E-04 | Autosave draft, commit ready map, переход к прохождению | E-03, DB-03, UX-02, QA-01 | Recovery без потери commit; Play только проверенной revision; повторное открытие не портит библиотеку |

E-01…03 можно выполнять до QA-01. E-04 завершает интеграцию после мобильного gate. Отсутствие телефона не блокирует независимые задачи.

## Генератор и сравнение

| ID | Задача и результат | Зависит от | Критерий готовности |
|---|---|---|---|
| GN-01 | Request schema, PRNG/variant seeds, counters и manifest | G-01, G-02, J-01 | GEN-01; variantIndex независим от числа вариантов; одинаковые потоки при одинаковых версиях; limits валидны |
| GN-02 | Frontier placement, site/module-budget и terminals | GN-01, G-04 | GEN-03/04/06; mixed catalog без switch по ID; fixed вход/выход; bounded attempts |
| GN-03 | Tree/cyclic, полная проверка, метрики и результат | GN-02, N-01, J-02 | GEN-02/07; циклы физически подтверждены; target-not-met отличим; длины 12/20 м физические |
| GN-04 | Deadline/cancel/resume и межплатформенный детерминизм | GN-03 | GEN-01/05 Chromium/WebView; clock не меняет успешный hash; незавершённое не ready; PERF-06 |
| GN-05 | Параметры, progressive variants и сравнение | GN-04, E-04, UX-01 | Полный сценарий, 3 варианта/60с, use-site default; без human score; выбор не теряет проект |
| GN-06 | Качество/время поиска и память | GN-05, B-03 | PERF-10 на development/regression seeds; неуспехи учтены; ограничения/seed не меняются скрыто |

## Первый рабочий выпуск

| ID | Задача и результат | Зависит от | Критерий готовности |
|---|---|---|---|
| QA-02 | Сквозная регрессия editor→variants→APK→record→JSON | GN-06, E-04, APK-03 | GEO/RUN/DB/REC/IO/UX/GEN, FAIL-01…06; нет старого ядра или пересчёта карт при списке |
| QA-03 | Воспроизводимые сборки и отчёт выпуска | QA-02 | Build/check/test/E2E; debug APK и hashes; VIS/PERF приложены; release signing отдельно при наличии ключа |

## Исследовательский этап после рабочего выпуска

| ID | Задача и результат | Зависит от | Критерий готовности |
|---|---|---|---|
| AN-01 | ObserverView и condition profiles | QA-03 | OBS-01/02; скрытые изменения/IDs не влияют; material observation-profile явный |
| AN-02 | Random/trémaux/frontier/heading baselines | AN-01 | AG-01/02, budgets/statuses/детерминизм; полного графа в policy нет |
| AN-03 | Физические left/right-hand и loop | AN-01 | Контакт с границей, остров/дуга/угол; loop по повтору физического состояния, timeout отдельно |
| AN-04 | Версионированные отчёты и человеческие записи | AN-02, AN-03, REC-03 | MET-01; denominators с timeout, distributions и версии; прошлые результаты не переписаны |
| AN-05 | Протокол и валидация на людях | AN-04 | Метрика/пороги до holdout; разделение карт/людей; validated/insufficient-data/rejected; участники — внешняя зависимость |
| AN-06 | Оптимизатор вектора критериев | AN-05, GN-04 | Только при validated: physical constraints/Pareto/budget/cancel/holdout; insufficient-data не считается завершением |

## Последующие расширения и прежние ID

FU-01: мосты/лестницы/уровни — отдельная спецификация после одноэтажного выпуска. Не входит в текущий граф зависимостей. Конструктор новых определений, дополнительные производственные формы, vortex и Windows-установщик — отдельные будущие задачи; базовая расширяемость уже входит в G-01…04.

Соответствие прежних крупных задач: T-01/02/22 → B и decisions; T-04/05/24 → G/N; T-06 → J; T-07 → R; T-08 → DB/UX; T-09 → REC; T-10 → QA-01; T-11 → E; T-12/13/23 → GN; T-14/15/18/19 → AN; T-20 → IO; T-21 → APK; T-17 → FU-01. T-16 (миграция) исключена.
