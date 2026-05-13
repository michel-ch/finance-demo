@echo off
REM Finch — DEMO build launcher.
REM Demo profile signups land with the mock seed data populated (accounts, tx, goals…).
REM Uses serve.py for no-cache headers so JSX edits show up on normal refresh.

setlocal
cd /d "%~dp0webapp"

set PORT=8766
set URL=http://localhost:%PORT%/index.html

where py >nul 2>&1
if not errorlevel 1 (
  echo [Finch Demo] No-cache static server on port %PORT%
  start "" "%URL%"
  py -3 serve.py %PORT%
  goto :eof
)

where python >nul 2>&1
if not errorlevel 1 (
  echo [Finch Demo] No-cache static server on port %PORT%
  start "" "%URL%"
  python serve.py %PORT%
  goto :eof
)

where npx >nul 2>&1
if not errorlevel 1 (
  echo [Finch Demo] Python not found. Falling back to npx http-server.
  start "" "%URL%"
  npx --yes http-server -p %PORT% -c-1
  goto :eof
)

echo [Finch Demo] Could not find Python or Node.
pause
