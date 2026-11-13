# Перенос Maze Lab на другой ПК

Для веб-версии нужны Git, Bun1.4.4 или новее и обычный современный браузер.
Установка Bun описана в [официальной инструкции](https://bun.sh/docs/installation).
Rust, Tauri, Android SDK и локальный браузер автора не требуются.

## Новый checkout и запуск

Выполняйте команды из корня репозитория. Если он уже скачан, обновите свою
чистую рабочую ветку вместо повторного клонирования. Установите Bun в PATH;
папки `.tools` и `node_modules` с другого компьютера переносить не нужно.

Windows PowerShell:

```powershell
git clone https://github.com/DurandalCode/maze-gen.git
cd maze-gen
bun --version
bun install --frozen-lockfile
bun run build
$env:PORT = '1420'
$env:MAZE_DATA_DIR = Join-Path $PWD '.local-data'
bun run serve
```

macOS/Linux:

```sh
git clone https://github.com/DurandalCode/maze-gen.git
cd maze-gen
bun --version
bun install --frozen-lockfile
bun run build
PORT=1420 MAZE_DATA_DIR="$PWD/.local-data" bun run serve
```

Откройте `http://127.0.0.1:1420`. Оставьте терминал сервера открытым; остановка —
Ctrl+C. Сервер слушает только этот компьютер. Если1420 занят, выберите другой
свободный порт и откройте соответствующий адрес. Старые ссылки автора на1428
и другие порты не переносят библиотеку на ваш ПК.

`MAZE_DATA_DIR` — каталог файловой библиотеки. Используйте один и тот же путь
для сервера и CLI-импорта. По умолчанию сервер хранит данные в `.local-data`
в корне репозитория; эти файлы не входят в Git. Смена порта/браузера может
открыть другое локальное состояние интерфейса, но файловая библиотека при том
же `MAZE_DATA_DIR` останется общей.

## Открыть точную игровую карту

В репозитории сохранены два самостоятельных примера:

- [`approved-vortex-ending-ring.json`](../examples/maps/approved-vortex-ending-ring.json) — одобренная концовка с короткой петлёй, исходный ID `4d0fb3b9d2c9ae84eb80bb0b`.
- [`approved-vortex-hybrid09.json`](../examples/maps/approved-vortex-hybrid09.json) — прежний одобренный гибрид09.

Нажмите «Открыть», выберите нужный JSON, затем при желании «В библиотеку».
Точная карта читается из геометрии JSON: повторная генерация по seed не
заменяет исторические A/B-правки. Контрольные суммы и локальные исключения
описаны в [каталоге примеров](../examples/maps/README.md). Для прохождения
используйте «Пройти от первого лица»; клавиша F отмечает ваш взгляд на
предполагаемый выход. Запись хранится отдельно от карты.

## Перенести личные карты, прохождения и F-метки

На исходном компьютере откройте именно ту библиотеку, где лежат ваши записи,
и выберите «Библиотека → Экспортировать записи». Перенесите скачанный JSON на
новый ПК. Экспорт содержит карты и полные записи, включая сохранённые
F-метки; изображения карты или отдельный JSON лабиринта историю не содержат.

На новом ПК запустите приложение и выберите «Библиотека → Импортировать
записи». Это основной способ переноса, CLI не обязателен. После импорта
проверьте список карт и прохождений, откройте одну завершённую запись и панель
меток выхода. Завершённая или более свежая запись не заменяется старым
checkpoint. Исходный архив сохраните до проверки переноса.

Для импорта через CLI сначала остановите локальный сервер. В PowerShell из
корня репозитория:

```powershell
$env:MAZE_DATA_DIR = Join-Path $PWD '.local-data'
bun scripts/import-library.ts --check 'C:\Users\YourName\Downloads\maze-library.json'
bun scripts/import-library.ts 'C:\Users\YourName\Downloads\maze-library.json'
bun run serve
```

На macOS/Linux:

```sh
MAZE_DATA_DIR="$PWD/.local-data" bun scripts/import-library.ts --check '/path/to/maze-library.json'
MAZE_DATA_DIR="$PWD/.local-data" bun scripts/import-library.ts '/path/to/maze-library.json'
PORT=1420 MAZE_DATA_DIR="$PWD/.local-data" bun run serve
```

`--check` проверяет архив без записи. Обычный запуск печатает количество карт
и прохождений после импорта. Передавайте **архив библиотеки**, у которого
`kind` равен `maze-lab-library-export`, а не одиночный JSON карты. Не
редактируйте вручную IDs, геометрию, F-метки или версии формата.

## Проверки разработчика

Обычное прохождение не требует Playwright. Для браузерных проверок путь к
установленному Chromium-браузеру передаётся явно, например в PowerShell:

```powershell
$env:MAZE_BROWSER = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
```

Используйте фактический путь вашего браузера. Проверки, создающие карты или
тестовые записи, запускайте с отдельным `MAZE_DATA_DIR`, а не с личной
библиотекой. macOS-путь Yandex в скриптах — лишь запасной вариант при отсутствии
`MAZE_BROWSER`, он не нужен серверу и не используется при обычной игре.

Windows-сборка в этой поставке не выполнялась: проверены переносимые команды
и пути в коде, но физического Windows-ПК в текущей сессии не было.

## Полная резервная копия этой сессии

Локальный архив `maze-gen-pc-transfer-20261113.tar.gz` передаётся отдельно от
GitHub: он содержит личные записи и F-метки. Он сохраняет исходные библиотеки
**раздельно**, вместе с `manifest.json`, контрольными суммами и `RESTORE.md`.
Не публикуйте архив и его распакованные данные в репозитории.

Основная последняя библиотека находится в
`maze-gen-pc-transfer-20261113/libraries/live-1428-direction-markers`.
Чтобы получить точное состояние рабочего1428, остановите сервер, распакуйте
архив вне checkout и скопируйте её папки `mazes` и `walks` в **новый пустой**
`MAZE_DATA_DIR`. Например, в PowerShell после копирования архива в Downloads:

```powershell
$backupRoot = Join-Path $env:USERPROFILE 'maze-gen-backup'
New-Item -ItemType Directory -Force $backupRoot | Out-Null
tar -xzf (Join-Path $env:USERPROFILE 'Downloads\maze-gen-pc-transfer-20261113.tar.gz') -C $backupRoot
$source = Join-Path $backupRoot 'maze-gen-pc-transfer-20261113\libraries\live-1428-direction-markers'
$env:MAZE_DATA_DIR = Join-Path $PWD '.local-data'
New-Item -ItemType Directory -Force $env:MAZE_DATA_DIR | Out-Null
Copy-Item (Join-Path $source 'mazes') $env:MAZE_DATA_DIR -Recurse
Copy-Item (Join-Path $source 'walks') $env:MAZE_DATA_DIR -Recurse
bun run serve
```

Этот пример предполагает, что `.local-data` ещё не содержит других данных.
Не копируйте сырые папки поверх существующей библиотеки: сначала сделайте её
копию либо выберите новый `MAZE_DATA_DIR`. На macOS/Linux распаковка обычным
`tar -xzf` и копирование тех же двух папок даёт такой же файловый формат.

Для добавления карт/записей из **остальных** исходных библиотек используйте их
отдельные `library-export.json`: UI «Импортировать записи» либо описанный выше
`bun scripts/import-library.ts --check <путь>` и затем импорт. Не объединяйте
сырые каталоги молча: одинаковый ID в двух источниках может представлять
разные по времени снимки. Импорт применяет штатные правила сохранения более
новых/завершённых записей и явно отклоняет конфликтующие карты/ID. Исходные
снимки архива остаются самостоятельной резервной копией. Сырые папки точнее
сохраняют административные статусы карт; JSON-обмен переносит карты и записи.

Резервная копия собирается из файловых библиотек сервера. Отдельные
браузерные IndexedDB/localStorage и ещё не отправленные оттуда записи в неё
не попадают: для них перед переездом дополнительно нужен UI-экспорт именно
из соответствующего браузера/офлайн-режима.
