@echo off
rem Optional: opens the Flow Automator page in your browser. Claude starts it by itself, so you rarely need this.
cd /d "%~dp0"
if not exist node_modules (
  echo Run setup.cmd first.
  pause
  exit /b 1
)
title Flow Automator - keep this window open
node server.js --open
pause
