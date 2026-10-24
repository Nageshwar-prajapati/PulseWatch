@echo off
title PulseWatch
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
    echo Python is not installed. Download it from https://www.python.org/downloads/
    echo During install, tick "Add python.exe to PATH". Then run this file again.
    pause
    exit /b 1
)
echo Installing requirements...
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo Failed to install requirements.
    pause
    exit /b 1
)
echo.
echo Starting PulseWatch at http://localhost:5000  (close this window to stop)
start "" http://localhost:5000
python app.py
pause
