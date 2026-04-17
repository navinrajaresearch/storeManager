@echo off
cd /d "%~dp0"

for /f "tokens=1-3 delims=-" %%a in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set TODAY=%%a-%%b-%%c
set OUT=store_manager_%TODAY%.zip

echo.
echo ================================================
echo   Store Manager — Ship
echo ================================================
echo.

REM ── Step 1: wipe Rust build cache ────────────────
echo ^> Cleaning Rust build cache...
where cargo >nul 2>&1
if not errorlevel 1 (
    cargo clean --manifest-path src-tauri\Cargo.toml
    echo [OK] target/ wiped
) else (
    echo [WARN] cargo not found — skipping
)

REM ── Step 2: zip source ───────────────────────────
echo.
echo ^> Zipping source...
if exist "%OUT%" del "%OUT%"

powershell -NoProfile -Command ^
  "$root = Get-Location;" ^
  "$out  = '%OUT%';" ^
  "$skip = @('target','node_modules','.venv','dist','.git');" ^
  "$files = Get-ChildItem -Recurse -File | Where-Object {" ^
  "  $rel = $_.FullName.Substring($root.Path.Length + 1);" ^
  "  $parts = $rel -split '[/\\\\]';" ^
  "  -not ($parts | Where-Object { $skip -contains $_ }) -and" ^
  "  $_.Extension -ne '.zip'" ^
  "};" ^
  "Compress-Archive -Path $files.FullName -DestinationPath $out -Force"

REM ── Step 3: report ───────────────────────────────
echo.
if exist "%OUT%" (
    for %%A in ("%OUT%") do set SIZE=%%~zA
    echo ================================================
    echo   Ready to ship:
    echo     %CD%\%OUT%
    echo ================================================
) else (
    echo [ERROR] Zip failed — check errors above
)

echo.
pause
