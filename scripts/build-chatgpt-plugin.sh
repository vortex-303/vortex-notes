#!/usr/bin/env bash
# Package the ChatGPT app/plugin ZIP (files at the ZIP root) → dist/vortex-notes-chatgpt.zip
set -euo pipefail
cd "$(dirname "$0")/.."
out=dist/vortex-notes-chatgpt.zip
tmp=$(mktemp -d)
cp plugins/chatgpt/plugin.json plugins/chatgpt/mcp.json "$tmp/"
cp -R plugins/chatgpt/assets "$tmp/assets"
mkdir -p "$tmp/skills" && cp -R plugins/vortex-notes/skills/vortex-notes "$tmp/skills/vortex-notes"
if grep -q "REPLACE-WITH" "$tmp/plugin.json"; then echo "⚠ plugin.json still has a placeholder (demo_recording_url)" >&2; fi
mkdir -p dist && rm -f "$out"
(cd "$tmp" && zip -qr - .) > "$out"
rm -rf "$tmp"
unzip -l "$out"
