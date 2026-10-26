@echo off
setlocal
cd /d "%~dp0"
if exist "tools\node\node.exe" set "PATH=%~dp0tools\node;%PATH%"
node launcher.cjs --stop
if errorlevel 1 pause
