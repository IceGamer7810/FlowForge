@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0generate-config.ps1"
exit /b %ERRORLEVEL%
