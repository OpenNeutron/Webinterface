#!/bin/sh
# Rebuild the client and print the hashes to compare with RELEASES.md.
set -e
npm ci
npm run build
echo "--- content hashes (compare these) ---"
sha256sum dist/assets/*.js dist/assets/*.css
