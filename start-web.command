#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Нужен Node.js 22 для запуска веб-прототипа.'
  exit 1
fi
if [ ! -f dist/index.html ]; then
  echo 'Сначала выполните bun install --frozen-lockfile и bun run build.'
  exit 1
fi
exec node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 1421 --strictPort
