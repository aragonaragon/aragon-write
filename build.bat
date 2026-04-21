@echo off
chcp 65001 > nul
title Aragon Write - Build
cd /d "%~dp0"
echo.
echo  =========================================
echo    Aragon Write - Building Desktop App
echo  =========================================
echo.
echo  [1/3] Building frontend...
call npm run build --workspace frontend
if errorlevel 1 ( echo  ERROR: Frontend build failed & pause & exit /b 1 )

echo.
echo  [2/3] Bundling backend...
call npm run build:backend
if errorlevel 1 ( echo  ERROR: Backend build failed & pause & exit /b 1 )

echo.
echo  [3/3] Packaging app...
call npx electron-packager . "Aragon Write" --platform=win32 --arch=x64 --out=app-release --overwrite --extra-resource=backend/dist/server.cjs "--ignore=(node_modules|\.git|dist-installer|app-release|backend/src|backend/node_modules|frontend/node_modules)" --prune=true
if errorlevel 1 ( echo  ERROR: Packaging failed & pause & exit /b 1 )

echo.
echo  =========================================
echo    Done! App is ready in: app-release\
echo  =========================================
echo.
start "" "app-release\Aragon Write-win32-x64"
