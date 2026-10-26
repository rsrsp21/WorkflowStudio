@echo off
setlocal
cd /d "%~dp0"
title Workflow Studio Companion
if exist "tools\node\node.exe" set "PATH=%~dp0tools\node;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Use the companion ZIP that includes Node.js, or ask IT for Node.js 24.
  pause
  exit /b 1
)
echo Opening Workflow Studio Companion...
call npm run start
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo The companion could not start. Check the error above or contact your IT team.
pause
exit /b 1
