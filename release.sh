#!/usr/bin/env bash
# Usage: ./release.sh <new-version>   e.g. ./release.sh 2.6.1.0
# Bumps the manifest, builds the .xpi, updates updates.json, commits, pushes
# and publishes a GitHub release so installed copies update themselves.
set -euo pipefail
V="${1:?usage: release.sh <version>}"
REPO="zgasparian/thunderbird-attach-from-clipboard"
ID="attach-from-clipboard-gnome@zgasparian.github.io"
cd "$(dirname "$0")"
python3 - "$V" <<'PY'
import re,sys
p='src/manifest.json'; m=open(p).read()
open(p,'w').write(re.sub(r'"version": "[^"]+"',f'"version": "{sys.argv[1]}"',m,1))
PY
XPI="attach_from_clipboard-$V-tb.xpi"
rm -f attach_from_clipboard-*-tb.xpi
(cd src && python3 -c "
import zipfile,os
with zipfile.ZipFile('../$XPI','w',zipfile.ZIP_DEFLATED) as z:
    for r,_,fs in os.walk('.'):
        for f in fs: z.write(os.path.join(r,f),os.path.join(r,f)[2:])
")
HASH="sha256:$(sha256sum "$XPI" | cut -d' ' -f1)"
cat > updates.json <<JSON
{
  "addons": {
    "$ID": {
      "updates": [
        {
          "version": "$V",
          "update_link": "https://github.com/$REPO/releases/download/v$V/$XPI",
          "update_hash": "$HASH"
        }
      ]
    }
  }
}
JSON
git add -A
git commit -m "Release v$V"
git push
gh release create "v$V" "$XPI" --repo "$REPO" --title "v$V" --notes "Release $V. Thunderbird updates itself from this release."
echo "Released $V"
