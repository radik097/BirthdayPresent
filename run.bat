@echo off
setlocal

cd /d "%~dp0"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=dev"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not available in PATH.
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] Installing npm dependencies...
  call npm install
  if errorlevel 1 exit /b %errorlevel%
)

if /i "%MODE%"=="dev" goto dev
if /i "%MODE%"=="check" goto check
if /i "%MODE%"=="rust" goto rust
if /i "%MODE%"=="build" goto build
if /i "%MODE%"=="pack" goto pack
if /i "%MODE%"=="portable" goto portable
if /i "%MODE%"=="unpacked" goto unpacked
if /i "%MODE%"=="help" goto help_ok

echo [ERROR] Unknown mode: %MODE%
goto help_err

:dev
echo [INFO] Starting development mode with Vite + Electron + the current runtime sidecar...
call npm run dev
exit /b %errorlevel%

:check
echo [INFO] Running TypeScript checks, Rust checks, and JS build...
call npm run typecheck
if errorlevel 1 exit /b %errorlevel%
call npm run check:rust
if errorlevel 1 exit /b %errorlevel%
call npm run build
exit /b %errorlevel%

:rust
echo [INFO] Building Rust sidecar and syncing downloader-core.exe to libs...
call npm run build:rust
exit /b %errorlevel%

:build
echo [INFO] Building Rust sidecar plus renderer and Electron main/preload bundles...
call npm run build:rust
if errorlevel 1 exit /b %errorlevel%
call npm run build
exit /b %errorlevel%

:pack
echo [INFO] Building unpacked Electron app directory...
call npm run app:dir
exit /b %errorlevel%

:portable
echo [INFO] Building portable distributable...
call npm run app:dist
exit /b %errorlevel%

:unpacked
if not exist "release\win-unpacked\Dismas Downloader.exe" (
  echo [ERROR] Unpacked app is missing. Run:
  echo   run.bat pack
  exit /b 1
)

echo [WARN] Running unpacked app requires real sidecar binaries in release\win-unpacked\libs.
start "" "release\win-unpacked\Dismas Downloader.exe"
exit /b 0

:help_ok
echo Usage:
echo   run.bat                ^(same as: run.bat dev^)
echo   run.bat dev            Start Vite + Electron in development mode
echo   run.bat check          Run typecheck, cargo check, and JS build
echo   run.bat rust           Build downloader-core.exe into libs
echo   run.bat build          Build Rust sidecar, dist, and dist-electron
echo   run.bat pack           Build release\win-unpacked
echo   run.bat portable       Build portable distributable
echo   run.bat unpacked       Run release\win-unpacked\Dismas Downloader.exe
echo   run.bat help           Show this help
exit /b 0

:help_err
echo Usage:
echo   run.bat                ^(same as: run.bat dev^)
echo   run.bat dev            Start Vite + Electron in development mode
echo   run.bat check          Run typecheck, cargo check, and JS build
echo   run.bat rust           Build downloader-core.exe into libs
echo   run.bat build          Build Rust sidecar, dist, and dist-electron
echo   run.bat pack           Build release\win-unpacked
echo   run.bat portable       Build portable distributable
echo   run.bat unpacked       Run release\win-unpacked\Dismas Downloader.exe
echo   run.bat help           Show this help
exit /b 1
