#!/bin/bash
# Double-click this file in Finder to install deps and launch Store Manager.

# Change to the directory containing this script
cd "$(dirname "$0")"

echo "================================================"
echo "  Store Manager — Setup & Launch"
echo "================================================"
echo ""

# ── Rust ──────────────────────────────────────────
# Always source cargo env first (covers cases where PATH is missing in GUI launch)
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"

if ! command -v cargo &>/dev/null; then
  echo "→ Rust not found. Installing via rustup…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
else
  echo "✓ Rust $(rustc --version 2>/dev/null | cut -d' ' -f2)"
fi

# ── Node.js ───────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo ""
  echo "✗ Node.js is required but not found."
  echo "  Install it from https://nodejs.org and re-run this script."
  echo ""
  read -p "Press Enter to close…"
  exit 1
else
  echo "✓ Node $(node --version)"
fi

# ── Homebrew ──────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  echo "→ Installing Homebrew…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# ── Protobuf compiler (required by LanceDB) ───────────────
if ! command -v protoc &>/dev/null; then
  echo "→ Installing protobuf compiler…"
  brew install protobuf
else
  echo "✓ protoc $(protoc --version 2>/dev/null)"
fi

# ── Python 3 — prefer Homebrew's own Python (writable) over system Python ─────
BREW_PYTHON="$(brew --prefix)/bin/python3"
if [ -x "$BREW_PYTHON" ]; then
  PYTHON="$BREW_PYTHON"
elif command -v python3 &>/dev/null; then
  PYTHON="python3"
else
  echo "→ Installing Python 3…"
  brew install python
  PYTHON="$(brew --prefix)/bin/python3"
fi
echo "✓ Python $($PYTHON --version 2>&1 | cut -d' ' -f2)  [$PYTHON]"

# ── PaddleOCR — install into a project-local .venv to avoid PEP 668 issues ────
VENV_DIR="$(pwd)/.venv"
VENV_PYTHON="$VENV_DIR/bin/python3"

if [ ! -x "$VENV_PYTHON" ]; then
  echo "→ Creating Python virtual environment for PaddleOCR…"
  $PYTHON -m venv "$VENV_DIR"
fi

echo "→ Checking PaddleOCR in venv…"
if ! "$VENV_PYTHON" -c "import paddleocr" 2>/dev/null; then
  echo "→ Installing PaddleOCR — this takes a few minutes the first time…"
  "$VENV_PYTHON" -m pip install --quiet paddlepaddle paddleocr
  if "$VENV_PYTHON" -c "import paddleocr" 2>/dev/null; then
    echo "✓ PaddleOCR installed"
  else
    echo "⚠ PaddleOCR install failed — will fall back to Tesseract for scanning"
  fi
else
  echo "✓ PaddleOCR ready"
fi

# ── Tesseract OCR (fallback if PaddleOCR fails) ────────────────────────────────
if ! command -v tesseract &>/dev/null; then
  echo "→ Installing Tesseract OCR (fallback scanner)…"
  brew install tesseract
else
  echo "✓ Tesseract $(tesseract --version 2>&1 | head -1 | cut -d' ' -f2) (fallback)"
fi

# ── Tesseract language packs ───────────────────────────────────────────────────
TESSDATA_DIR="$(brew --prefix)/share/tessdata"
MISSING_LANGS=()
for lang in hin tam tel; do
  [ ! -f "$TESSDATA_DIR/${lang}.traineddata" ] && MISSING_LANGS+=("$lang")
done
if [ ${#MISSING_LANGS[@]} -gt 0 ]; then
  brew install tesseract-lang
fi

# Ensure Homebrew binaries (protoc, pkg-config, etc.) are on PATH
export PATH="$(brew --prefix)/bin:$(brew --prefix)/sbin:${PATH}"
export PKG_CONFIG_PATH="$(brew --prefix)/lib/pkgconfig:${PKG_CONFIG_PATH:-}"

# ── Dependencies ──────────────────────────────────
echo ""
echo "→ Installing npm dependencies…"
npm install

# ── Launch ────────────────────────────────────────
echo ""
echo "→ Starting Store Manager…"
echo ""
npm run tauri dev
