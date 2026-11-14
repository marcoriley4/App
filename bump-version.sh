#!/bin/sh
# Give CSS/JS links a new version so phones load fresh files after an update. Run before each commit.
cd "$(dirname "$0")"
V=$(date +%Y%m%d%H%M)
for f in index.html admin.html crew.html sales.html; do
  sed -i -E "s/\.(css|js)(\?v=[0-9]+)?\"/.\1?v=$V\"/g" "$f"
done
echo "version $V"
