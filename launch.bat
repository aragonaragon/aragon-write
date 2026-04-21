@echo off
chcp 65001 > nul
cd /d "%~dp0"
start "" "%~dp0app-release\Aragon Write-win32-x64\Aragon Write.exe"
