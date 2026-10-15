@echo off
where node.exe >nul 2>nul
if errorlevel 1 goto direct
node "%~dp0launcher.cjs"
if errorlevel 1 pause
exit /b
:direct
start "" "%~dp0dist\index.html"
