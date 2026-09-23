@echo off
setlocal
cd /d "%~dp0"
title YouTube Volume Normalizer - Transcription Server

set "PYTHON=%~dp0..\yt_volume_normalizer_venv\Scripts\python.exe"
set "SERVER=%~dp0transcription_server.py"

if not exist "%PYTHON%" (
    echo [ERROR] 找不到 Python 虛擬環境：
    echo %PYTHON%
    echo 請先依照 README.md 安裝環境。
    pause
    exit /b 1
)

if not exist "%SERVER%" (
    echo [ERROR] 找不到 transcription_server.py：
    echo %SERVER%
    pause
    exit /b 1
)

powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo 語音辨識服務已經在執行中：ws://127.0.0.1:8765
    echo 不需要再次啟動，請直接使用 Chrome 擴充功能。
    pause
    exit /b 0
)

echo YouTube Volume Normalizer 語音辨識服務啟動中...
echo 請保持此視窗開啟。看到 listening on ws://127.0.0.1:8765 即可使用。
echo.
"%PYTHON%" "%SERVER%"

set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo 語音辨識服務已停止，結束代碼：%EXIT_CODE%
pause
exit /b %EXIT_CODE%
