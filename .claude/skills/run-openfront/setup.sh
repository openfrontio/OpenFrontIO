#!/usr/bin/env bash
# One-time per-machine setup for headless-Chromium driving of OpenFront.
# No sudo needed: Playwright's chromium is downloaded with a platform
# override, and its missing system libraries are extracted locally from
# .deb packages.
set -euo pipefail

CACHE="${OPENFRONT_RUN_CACHE:-$HOME/.cache/openfront-run}"
mkdir -p "$CACHE/debs" "$CACHE/fonts" "$CACHE/fc-cache"

# 1. Playwright (not a project dependency; --no-save keeps package.json clean)
npm ls playwright > /dev/null 2>&1 || npm install --no-save playwright

# 2. Chromium headless shell. Playwright refuses to download on Ubuntu 26.04
#    ("does not support chromium on ubuntu26.04-x64"); the ubuntu24.04 build
#    is ABI-compatible, so override the host platform.
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install chromium

# 3. Shared libraries the headless shell needs that a minimal host lacks
#    (found via: ldd chrome-headless-shell | grep "not found").
(
    cd "$CACHE/debs"
    apt-get download \
        libnspr4 libnss3 libasound2t64 libatk1.0-0t64 libatk-bridge2.0-0t64 \
        libatspi2.0-0t64 libgbm1 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
        libxext6 libxfixes3 libxrandr2 libxau6 libxdmcp6 libxi6 libxrender1 \
        libxres1 fonts-dejavu-core
    for f in *.deb; do dpkg -x "$f" "$CACHE/extracted"; done
)

# 4. Fonts. This host has no /etc/fonts at all, and Skia FATALs without a
#    fontconfig (SkFontMgr_FontConfigInterface.cpp "Not implemented").
cp "$CACHE/extracted/usr/share/fonts/truetype/dejavu/"*.ttf "$CACHE/fonts/"
cat > "$CACHE/fonts.conf" << CONF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>$CACHE/fonts</dir>
  <cachedir>$CACHE/fc-cache</cachedir>
</fontconfig>
CONF

echo "setup complete: $CACHE"
