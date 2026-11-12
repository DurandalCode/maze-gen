# Вортексный рисунок свободной планировки — пробный режим

Новый параметр `freeRoutePattern: 'vortex'` сохраняется в обычной native free
v5 модели. Старые organic / switchbacks и их сохранения не меняются.

Четыре переплетённые архимедовы спирали строятся из настоящих рам 2×2.
Каждый следующий модуль меняет радиус и индивидуальный угол, поэтому это
не концентрические кольца и не общий поворот ортогональной решётки.
Поиск следующего шага максимизирует боковую стенку соединения до 3 м.
Перекрёстки соединяют реальные грани соседних спиралей. Seed выбирает,
какие из допустимых переходов закрываются; сохраняются связность и реальные
альтернативы. Каждое закрытие проверяется по физическим doorway-path длинам,
финальная карта повторно проверяется с полной native навигацией и стойками.

Стартовый пресет: 96 модулей, площадка 60×60 м, максимальная боковина 3 м,
40 циклов. Размеры — от 80 модулей с шагом 4, при достаточной площадке.
Невыполнимое сочетание возвращает ошибку, не уменьшает число модулей и не
меняет заданное число циклов. Ширина дверей ограничена сверху 1.6 м для
поворотов; меньшая запрошенная ширина сохраняется. Межспиральные замыкания
могут быть короче 3 м: реальные опоры уже фиксированы, причина в spanAudit.
Порталы находятся на противоположных наружных гранях. Крыша включена.

Режим использует собственный bounded алгоритм. Настройки organic роста
(разброс углов, степень развилок и Prim/Backtracker) не управляют его
спиральным каркасом. Мосты, зоны и cavity-infill пока не сочетаются с ним.
Геометрически ветви имеют общую закрутку; направление движения меняется
при переходах между ними. Разнесённые центры и геометрически встречная
закрутка — следующая итерация, не заявляются реализованными здесь.

На seed vortex-01 проверяются native validation, конструктивное происхождение
всех стен, капсульные проходы всех рёбер и порталов, реальный Player от входа
до выхода, точный seed replay и JSON roundtrip. Смысловая регрессия проверяет
монотонное изменение радиуса и полный оборот каждой ветви. Интересность и
способность запутать игрока численными оценками не объявляются доказанными.

Подготовка карты: `bun scripts/prepare-vortex.ts`, собственная `.local-data`.
Сервер: `PORT=1423 bun server/index.ts` после сборки. Browser smoke:
`MAZE_GEOMETRY_ID=<id> bun scripts/vortex-browser-check.ts`.

## Структурные ловушки — вариант02

`routeTrapCount: 1, loopTrapCount: 1` включают один конструктивный комплект
в обычном генераторе. Требуется 96 базовых рам, рекомендована площадка70×70м;
итог97рам, включая одну настоящую2×6 с доступным полом и физическими стойками.
Большие запрошенные количества пока явно отклоняются, не имитируются циклами.
Режим без требований к ловушкам сохраняет прежнюю геометрию и seed replay01.

Входная переплетённая область приходит на четыре настоящих двери одного
возвратного перекрёстка. Два ложных выхода образуют изолированный контур около43м,
а остальные продолжают основной путь. В кольце есть длинные дополнительные
ветви, поэтому предел16м не обеспечивается декоративными маленькими карманами.
Дальше отдельная развилка предлагает приближающую к выходу ложную ветвь и
правильное продолжение, которое сначала вынужденно удаляется от выхода.
Область после неё сохраняет множество поперечных альтернатив между спиралями.

Косые стыки дополнительно резервируют окружность квадратной стойки для любого
общего поворота. Если нужно, смещения проёмов меняются, ширина увеличивается
в пределах пользовательского максимума до1.8м; стены остаются между реальными
рамами, их максимальная боковая сторона не превышает3м. Коллизии не ослабляются.

Формулы квалификации Л/К не менялись. Их признаки видимости вычисляются только
после нахождения подходящей топологической компоненты. Полный диагностический
результат на исходной проверенной геометрии до/после этой оптимизации одинаков.

Карта02: `bun scripts/prepare-vortex-traps.ts`; JSON и отчёт отдельные от01.

## Центральный пресет03

`freeVortexCenter: true` выбирает отдельную структуру; `centralVortexParameters`
задаёт96 исходных позиций,70×70м,16циклов, `routeTrapCount:2,loopTrapCount:2`.
Новый checkbox есть в настройках и редакторе. Старые01/02 и их параметры
без этого флага сохраняют прежнюю структуру. Итог03 —98 настоящих рам:
91 квадратная и7 шестиметровых. Три лишние исходные позиции исключаются;
в двух позициях сразу строятся2×6рамы, добавляются четыре длинные боковые
комнаты и одна центральная2×6рама с тремя физическими дверями.

Маршрут соединяет региональные переплетения, два возвратных перекрёстка,
два независимых ложных приближения к цели и центр. На целевом seed
vortex-center-03 подтверждены Л2/К2, целые длины7.00/14.44м, наружные
противоположные опорные плоскости порталов. Не предполагается обязательное
посещение всех ответвлений: в региональных областях сохраняются альтернативы.

Малый сравнительный аудит:64прогона существующего compass-профиля,
порог вероятности0.25. Крупнейшая холодная область02:36комнат/~370м²;
у03:4комнаты/~35м². В обеих выборках100% завершений. Крупнейшая компонента
вне кратчайшего маршрута уменьшилась39→15комнат; эти15 являются возвратной
ловушкой, а не обходом большей части карты. Это ограниченная выборка одного
профиля, не обещание отсутствия холодных областей или интересности игры.

Обнаружена и исправлена ошибка native-проверки: она проверяла прямую хорду
между внутренними точками дверей, хотя фактический путь поворачивает в двух
серединах проёмов. Теперь точно проверяются реальные три сегмента соединения;
пути внутри комнат уже проверены localRoute. Геометрический broad phase
исключает заведомо дальние препятствия; размеры коллизий не менялись.
Регрессия демонстрирует блокирующуюся хорду и физически чистый настоящий путь.

Сохранение03: `bun scripts/prepare-vortex-center.ts`.
Browser: `bun scripts/vortex-center-browser-check.ts`.
Проверяется обычная worker-генерация, затем экспорт всех параметров/геометрии
и четыре метки overlay. Между Bun и браузером максимальная численная разница
на целевом seed7.1e-15; сравнение использует1e-8, меньше геометрическогоEPS.

## Разнесённые косые узлы — пресет04

`freeVortexKnots:true` / `knottedVortexParameters` задают отдельную игровую
итерацию. Она планирует существующий центральный каркас заново: убирает четыре
длинных наружных радиальных терминала, превращает прежние коридорные тупики
во внутренние возвраты и заменяет соседние квадратные рамы реальными2×6
перекрёстками. Произвольных стен, невидимых опор и сеточного runtime нет.
Предпочтения индивидуальных углов новых комнат зависят от seed; это не один
общий поворот готовой схемы. Предыдущие пресеты01–03 не меняются.

На целевом `vortex-knots-04`:88 реальных рам, четыре внецентральных2×6узла
с3/3/3/5дверями, внутренняя2×6комната-разворот с входами на одной стороне.
Первый широкий перекрёсток сразу после стартовой комнаты. Один дополнительный
проектируемый боковой узел не нашёл допустимого размещения в ограниченном
подборе: его пара рам сохранена. Межмодульные боковины не превышают3м,
полные длины3.30/15.39м, крыша и противоположные наружные порталы сохранены.

По неизменным специальным квалификаторам Л0/К0. В пресете21 обычный цикл;
это не выдаётся за21 квалифицированную возвратную ловушку. По отзыву игрока
приоритет здесь у реальных смен локальной геометрии и неоднозначных возвратов,
а не у удлинения тупиков для счётчиков. Человеческий эффект требует прохождения.
При нулевых запрошенных минимумах обязательный анализ ловушек не задерживает
обычную генерацию; точные квалификаторы доступны через overlay.

В единственной64-sample compass-выборке largest cold region4комнаты/~35.5м²,
завершений100%. Это ограниченная проверка, не оценка сложности или гарантия
дезориентации. Регрессии проверяют действительные рамы/двери, раннюю развилку,
отсутствие внешних хвостов, независимые наклонные оси узлов, все капсульные
пути, Player, дополнительный поворот45°, JSON и обычный seeded replay.
Browser отдельно проверяет новый пресет, успешную worker-генерацию, экспорт,
честный пустой overlay, движение/паузу и редактор.

Подготовка: `bun scripts/prepare-vortex-knots.ts`.
Browser: `bun scripts/vortex-knots-browser-check.ts`.
Размер исходного каркаса этого пробного пресета пока96 позиций; итоговое число
рам уменьшается при удалении лишних позиций и объединении пар в2×6комнаты.

### Chaotic profile (05, experimental)

The new persisted `freeVortexChaotic` preset combines the central two-tree/two-return topology with individually fitted square-frame orientations. It does not switch off requested trap minima. Ordinary generation rejects a candidate if the unchanged route/loop qualifiers do not confirm the requested counts. The off-centre-knots preset also preserves explicitly requested minima instead of silently replacing them with zero; old saved 04 parameters already contain zero and retain their replay.

Four exposed terminal extensions are replaced with native tangential two-door return rooms. False branches split inside the maze; the entrance has a real six-metre interchange. Each altered joint is rebuilt against actual frame faces, floor polygons and posts. Repairs are deterministic and bounded. Frame displacement and angle statistics exclude a global rotation; the original spiral scaffold remains an intentional backbone, rather than a claim of arbitrary random placement.

05 verified seed `vortex-chaotic-05`: 97 real frames (9 six-metre), 17 cycles, qualified Л2/К2. Of 90 retained spiral frames, 52 differ from the single-centre Archimedean tangent by at least 10°, 30 by at least 20°; all four sectors contain such frames. Maximum deviation 32.66°. After removing best-fit translation, rotation and uniform scale against 03, positional RMS is 0.39 m and maximum 0.93 m: individual positions remain moderately irregular, while angular variation is deliberately stronger. Full ground straight/run 4.30/14.33 m, maximum connector side 3 m. Targeted regression, actual Player, browser seeded replay/JSON, joystick/pause, qualified overlay and editor checks pass; full repository suite was not rerun for this prototype.

### Return districts (06, experimental)

`freeVortexDeepRegions` is an explicit modifier of the chaotic profile. Generation retains its individual frame poses and adds fitted connections only inside the two pendant return districts. A native 2×2 room closes a deeper pocket in the first district. Two rooms in former side branches become through choices; the second district gains an inner return and an oblique cross-return. No connection leads from a district to another main-route sector.

The unchanged trap qualifiers accept Л2/К2. This is supplemented by a separate structural acceptance guard: exactly two doors at the original fork, no entrance/exit in the district, at least three independent cycles wholly inside it, six internal junctions and a junction more than 15 m from the fork. On the verified candidate each district has 14 rooms; their internal junction counts are 6 and 7, and farthest physical navigation distances from the fork are 26.6 and 29.4 m. These describe actual choices and depth, not a prediction that a human will continue instead of turning back. The layout has 98 native frames, 21 overall cycles, whole-ground lengths 4.30/14.33 m, and maximum connector side 3 m. Existing 05 geometry and records remain unchanged. The profile intentionally reuses seed `vortex-chaotic-05` with the new persisted modifier; it regenerates the construction through the ordinary generator instead of importing and patching the saved 05 map.

### Continuous winding loops (07, experimental)

The next explicit profile, `freeVortexContinuous`, follows the revised player request rather than extending 06. Both false circuits have no internal junctions or dead-end branches. The true route also contains continuous winding stretches; the two qualified dead-end traps remain outside the circuits. Ordinary generation rebuilds the successful chaotic frame assembly and selects the continuous network, retaining an early false choice and the real central hall. The result has 72 native frames and two cycles; existing maps and other profiles are preserved.

A qualified return circuit is at least 40 m long. A pure circuit cannot also satisfy the ordinary maximum uninterrupted run of 16 m. Only deliberately selecting 07 sets the persisted `design.maxForcedRun=60`, keeping `maxForcedStraight=8`; leaving this profile restores the ordinary run16. Loading old JSON never changes its explicit bounds. No measurement or trap formula is weakened and no decorative junction is added to conceal the long path.

The canonical full physical measurement is straight3.764/run52.735 m. For consistent comparisons, the structural report now uses the same doorway-to-doorway paths through rooms, instead of forcing a detour through every room centre. Circuit lengths are40.69/51.33 m; true continuous fragments are28.77/52.74/34.06/30.47 m. The earlier54.33 m figure included unnecessary intermediate room-centre detours. Both circuits have degree2 at every interior frame, no internal dead ends, and exactly two doors at the original fork. Eye-level physical rays cannot see that fork after two rooms from either entrance. The unchanged UI qualifiers still confirm Л2/К2 (their own established circuit-length definition is unchanged).

### Spatially deeper composition (08, experimental)

`freeVortexMultiBand` is a separate seeded composition on branch `feat/free-vortex-deep-loops`, based on freeze38a9f27. It reserves false and genuine chains before fitting the frames. Two shifted local centres have distinct angular schedules. Each false chain contains actual tangential native-room connections on radial strips16.2/12.6/9/5.4m and three actual radial connections between those strips. The return uses a separate chain. No interior junction or dead-end branch is introduced. Both genuine continuations immediately at the same forks also cross those three bands before their next decision.

The new profile has83 frames, including4 real2×6 halls, on100×80m. Existing profiles, saved maps and their limits are preserved. This profile explicitly saves straight8/run60. Verified canonical full lengths are5.68/52.18m; return chains50.43/52.18m and immediately corresponding genuine chains42.91/44.15m. False inward excursions are13.95m, genuine excursions10.8m; angular coverage is163°/140°. These are four physical arc strips, with tangential native edges, rather than room-count or graph-depth labels. The ordinary seeded generator rejects failure of these spatial contracts, scoped lengths, sole-fork continuous returns, hidden fork sightlines or unchanged Л2/К2 qualifiers.

The targeted seed `vortex-multi-band-08` passes844 capsule legs and an actual Player completion, three regressions/1099 assertions, TypeScript/build, browser joystick/pause/editor and ordinary cross-engine seeded replay/JSON (maximum numeric delta1.42e-14). UI overlay confirmsЛ1/Л2/К1/К2. No full repository suite or psychological rating was run for this experimental profile. The composition is controlled and currently fixes83 frames; arbitrary module counts/plot sizes are not claimed. Formal trap labels and geometric similarity still do not predict a human's decision to continue or reverse.
