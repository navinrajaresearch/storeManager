#!/bin/bash
# Double-click in Finder (or run ./ship.command) to clean and zip the project.

cd "$(dirname "$0")"

TODAY=$(date +%Y-%m-%d)
OUT="store_manager_${TODAY}.zip"

echo ""
echo "================================================"
echo "  Store Manager — Ship"
echo "================================================"
echo ""

# ── Step 1: wipe Rust build cache ─────────────────
echo "→ Cleaning Rust build cache (this is the 13-18 GB folder)…"
if command -v cargo &>/dev/null; then
  cargo clean --manifest-path src-tauri/Cargo.toml
  echo "✓ target/ wiped"
else
  echo "⚠ cargo not found — skipping (target/ not cleaned)"
fi

# ── Step 2: zip source ────────────────────────────
echo ""
echo "→ Zipping source…"
rm -f "$OUT"
zip -r "$OUT" . \
  --exclude='*/target/*' \
  --exclude='*/node_modules/*' \
  --exclude='*/.venv/*' \
  --exclude='*/dist/*' \
  --exclude='*/.git/*' \
  --exclude='*.DS_Store' \
  --exclude='*.zip'

# ── Step 3: report ────────────────────────────────
echo ""
if [ -f "$OUT" ]; then
  SIZE=$(du -sh "$OUT" | cut -f1)
  echo "================================================"
  echo "  ✓ Ready to ship:"
  echo "    $(pwd)/$OUT"
  echo "    Size: $SIZE"
  echo "================================================"
else
  echo "✗ Zip failed — check errors above"
fi

echo ""
read -p "Press Enter to close…"
