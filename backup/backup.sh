#!/bin/bash
# autoform-panel — daily backup of runtime data (catalog mirror + pairing tickets).
# Keeps the last 14 archives inside the project (backup/), so the whole project stays self-contained.
set -euo pipefail
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$PROJECT/data"
DEST="$PROJECT/backup"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DEST"

# Consistent snapshot of the pairing SQLite (safe while the service runs), then archive data/.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if [ -f "$DATA/pairing.sqlite" ]; then
  sqlite3 "$DATA/pairing.sqlite" ".backup '$TMP/pairing.sqlite'"
fi
tar -C "$DATA" -czf "$DEST/autoform-data-$STAMP.tgz" \
  --exclude='pairing.sqlite-wal' --exclude='pairing.sqlite-shm' \
  $( [ -f "$TMP/pairing.sqlite" ] && echo "-C $TMP pairing.sqlite -C $DATA" ) catalog 2>/dev/null || \
  tar -C "$DATA" -czf "$DEST/autoform-data-$STAMP.tgz" .

# Retain the 14 most recent.
ls -1t "$DEST"/autoform-data-*.tgz 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "backup written: $DEST/autoform-data-$STAMP.tgz"
