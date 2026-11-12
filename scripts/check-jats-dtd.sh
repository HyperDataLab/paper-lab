#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
export XML_CATALOG_FILES="$PWD/tools/jats-dtd-1.4/catalog-jats-v1-4-no-base.xml"
shopt -s nullglob
files=(.jats-check/*.xml)
if ((${#files[@]} == 0)); then
  echo 'No JATS fixtures found in .jats-check/' >&2
  exit 1
fi
status=0
for file in "${files[@]}"; do
  echo "Validating $file"
  xmllint --noout --nonet --catalogs --valid "$file" || status=1
done
exit "$status"
