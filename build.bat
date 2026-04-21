@echo off
chcp 65001 > nul
title Aragon Write - Build
cd /d "%~dp0"
echo.
echo  =========================================
echo    Aragon Write - Building Portable App
echo  =========================================
echo.

echo  [1/4] Building frontend...
call npm run build --workspace frontend
if errorlevel 1 ( echo  ERROR: Frontend build failed & pause & exit /b 1 )

echo.
echo  [2/4] Bundling backend...
call npm run build:backend
if errorlevel 1 ( echo  ERROR: Backend build failed & pause & exit /b 1 )

echo.
echo  [3/4] Packaging app...
call npx electron-packager . "Aragon Write" --platform=win32 --arch=x64 --out=app-release --overwrite --no-asar --extra-resource=backend/dist/server.cjs "--ignore=(node_modules|\.git|dist-installer|app-release|backend/src|backend/node_modules|frontend/node_modules)" --prune=true
if errorlevel 1 ( echo  ERROR: Packaging failed & pause & exit /b 1 )

echo.
echo  [4/4] Creating portable ZIP...
powershell -Command "Compress-Archive -Path 'app-release\Aragon Write-win32-x64\*' -DestinationPath 'app-release\Aragon-Write-portable.zip' -Force -CompressionLevel Optimal"
if errorlevel 1 ( echo  WARNING: ZIP creation failed, but app folder is ready )

echo.
echo  =========================================
echo    Done!
echo    App folder : app-release\Aragon Write-win32-x64\
echo    Portable ZIP: app-release\Aragon-Write-portable.zip
echo  =========================================
echo.
start "" "app-release"
