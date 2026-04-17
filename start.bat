@echo off
REM Double-click this file to install deps and launch Store Manager on Windows.

cd /d "%~dp0"

echo ================================================
echo   Store Manager — Setup and Launch
echo ================================================
echo.

REM ── Rust ─────────────────────────────────────────
where cargo >nul 2>&1
if errorlevel 1 (
    echo Rust not found. Installing via rustup...
    powershell -Command "Invoke-WebRequest -Uri https://win.rustup.rs -OutFile rustup-init.exe; Start-Process rustup-init.exe -ArgumentList '-y' -Wait; Remove-Item rustup-init.exe"
    set PATH=%USERPROFILE%\.cargo\bin;%PATH%
) else (
    for /f "tokens=2" %%v in ('rustc --version 2^>nul') do echo [OK] Rust %%v
)

REM ── Node.js ───────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Node.js is required but not found.
    echo   Install it from https://nodejs.org and re-run this script.
    echo.
    pause
    exit /b 1
) else (
    for /f %%v in ('node --version 2^>nul') do echo [OK] Node %%v
)

REM ── protoc (required by LanceDB) ──────────────────
where protoc >nul 2>&1
if errorlevel 1 (
    echo.
    echo [WARNING] protoc not found. Installing via winget...
    winget install --id Google.Protobuf -e --silent 2>nul
    if errorlevel 1 (
        echo   Could not auto-install protoc.
        echo   Download from https://github.com/protocolbuffers/protobuf/releases
        echo   and add it to PATH, then re-run this script.
        pause
        exit /b 1
    )
) else (
    for /f "tokens=1,2" %%a in ('protoc --version 2^>nul') do echo [OK] %%a %%b
)

REM ── Python 3 ─────────────────────────────────────
where python >nul 2>&1
if errorlevel 1 (
    echo Python not found. Installing via winget...
    winget install --id Python.Python.3.11 -e --silent
    set PATH=%LOCALAPPDATA%\Programs\Python\Python311;%PATH%
)
for /f "tokens=2" %%v in ('python --version 2^>nul') do echo [OK] Python %%v

REM ── PaddleOCR venv ───────────────────────────────
set VENV_DIR=%~dp0.venv
set VENV_PYTHON=%VENV_DIR%\Scripts\python.exe

if not exist "%VENV_PYTHON%" (
    echo Creating Python virtual environment for PaddleOCR...
    python -m venv "%VENV_DIR%"
)

echo Checking PaddleOCR in venv...
"%VENV_PYTHON%" -c "import paddleocr" >nul 2>&1
if errorlevel 1 (
    echo Installing PaddleOCR — this takes a few minutes the first time...
    "%VENV_PYTHON%" -m pip install --quiet paddlepaddle paddleocr
    "%VENV_PYTHON%" -c "import paddleocr" >nul 2>&1
    if errorlevel 1 (
        echo [WARNING] PaddleOCR install failed — will fall back to Tesseract for scanning
    ) else (
        echo [OK] PaddleOCR installed
    )
) else (
    echo [OK] PaddleOCR ready
)

REM ── Tesseract OCR (fallback) ─────────────────────
where tesseract >nul 2>&1
if errorlevel 1 (
    echo Installing Tesseract OCR fallback scanner...
    winget install --id UB-Mannheim.TesseractOCR -e --silent 2>nul
    if errorlevel 1 (
        echo [WARNING] Could not auto-install Tesseract. OCR fallback will be unavailable.
        echo   Download from https://github.com/UB-Mannheim/tesseract/wiki
    )
) else (
    for /f "tokens=1,2" %%a in ('tesseract --version 2^>nul') do echo [OK] Tesseract %%a %%b
)

REM ── npm dependencies ─────────────────────────────
echo.
echo Installing npm dependencies...
npm install

REM ── Launch ───────────────────────────────────────
echo.
echo Starting Store Manager...
echo.
npm run tauri dev
