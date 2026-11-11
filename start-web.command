#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Нужен Node.js 22 для запуска веб-прототипа.'
  exit 1
fi
if [ ! -f node_modules/vite/bin/vite.js ]; then
  echo 'Сначала выполните bun install --frozen-lockfile.'
  exit 1
fi
exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1421 --strictPort
