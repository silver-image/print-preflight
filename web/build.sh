#!/bin/bash
set -e
cd "$(dirname "$0")/.."
OUT=web/dist/print-preflight.js
{
  echo "/* Silver Image Print Preflight — bundle. Analiza w 100% lokalna, plik nie opuszcza urzadzenia. */"
  echo "(function(){"
  sed -E 's/^export (class|function|const)/\1/' core/dist/esm/core.js | grep -v '^export '
  cat web/dist/ui.js
  echo "})();"
} > "$OUT"
node -e "new Function(require('fs').readFileSync('$OUT','utf8'))" && echo "bundle OK: $OUT ($(wc -c < "$OUT") B)"
