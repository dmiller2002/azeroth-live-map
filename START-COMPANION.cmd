@echo off
setlocal
cd /d "%~dp0"
if exist "release\1.0.1\win-unpacked\Drunks Azeroth Companion - Forever.exe" (
  start "" "release\1.0.1\win-unpacked\Drunks Azeroth Companion - Forever.exe"
  exit /b 0
)
if exist "node_modules\.bin\electron.cmd" (
  call "node_modules\.bin\electron.cmd" .
  exit /b
)
echo Extract the Windows release ZIP and run Drunks Azeroth Companion - Forever.exe.
echo For source development, install Node.js and run npm ci in this folder.
pause
