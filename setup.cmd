@echo off
rem Double-click once to install Flow Automator and add it to Claude.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then double-click this file again.
  start https://nodejs.org
  pause
  exit /b 1
)
echo Installing... this takes a minute the first time.
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo Install failed. See the messages above.
  pause
  exit /b 1
)
node setup.js
pause
