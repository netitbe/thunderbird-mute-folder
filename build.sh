#!/bin/sh
# Builds dist/mute-folder-notifications.xpi (an XPI is just a zip with manifest.json at its root).
set -e
cd "$(dirname "$0")"
mkdir -p dist
rm -f dist/mute-folder-notifications.xpi
zip -r dist/mute-folder-notifications.xpi \
  manifest.json schema.json COPYRIGHT LICENSE implementation.js background.js \
  icons/icon-32.png icons/icon-48.png icons/icon-64.png icons/icon-96.png
