@echo off
setlocal DisableDelayedExpansion
title Drunks Azeroth UI
echo Drunks Azeroth UI - Windows companion
echo.
echo Leave this window open while using the map.
echo Once the server starts, open Chrome or Edge at:
echo http://localhost:8765/
echo.

if not exist "%~dp0Companion\dist\index.html" goto incomplete
if not exist "%~dp0Companion\scripts\serve.py" goto incomplete

py -3 -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 goto run_py
python -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 goto run_python

echo Python 3.10 or newer was not found.
echo Install Python from https://www.python.org/downloads/windows/
echo Complete its setup, then open START-MAP.cmd again.
echo See README.txt for installation instructions.
goto finished

:run_py
py -3 "%~dp0Companion\scripts\serve.py"
goto finished

:run_python
python "%~dp0Companion\scripts\serve.py"
goto finished

:incomplete
echo The Companion files are missing. Extract the entire ZIP first.
echo Keep START-MAP.cmd next to the Companion folder.

:finished
echo.
echo The local map server is stopped or could not start.
echo If an error appeared above, see README.txt for help.
pause
endlocal
